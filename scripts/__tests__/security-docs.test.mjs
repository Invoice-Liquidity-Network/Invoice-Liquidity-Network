import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  checkSecurityDocs,
  extractTable,
  mentionedPaths,
  parseEvidence,
  threatSections,
} from '../lib/security-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── A minimal, consistent repository fixture ──────────────────────────────────

const HEADERS = `export const SECURITY_HEADERS = Object.freeze({ 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-site' });
export function applySecurityHeaders(app) { app.disable('x-powered-by'); }
`;
const INDEXER_API = `export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  applySecurityHeaders(app);
  app.use(rateLimiter());
  app.get('/health', h);
}
`;
const ORACLE_INDEX = `function createRateLimitMiddleware() {}
export async function createOracleApp() {
  const app = express();
  applySecurityHeaders(app);
  app.use(express.json({ limit: '256kb' }));
}
`;

function threatModel({
  rows = DEFAULT_ROWS,
  sections = '### 1.1 Dependencies\n\n### 2.1 Framing\n',
  extra = '',
} = {}) {
  return `# Threat Model

${sections}
${extra}

<!-- mitigations:begin -->
| ID | Threat | Status | Evidence | Owner |
|---|---|---|---|---|
${rows.join('\n')}
<!-- mitigations:end -->
`;
}

const DEFAULT_ROWS = [
  '| TM-1.1 | §1.1 Dependencies | enforced | `indexer/src/rateLimit.ts#createApiRateLimiter`, `indexer/tests/rateLimit.test.ts` | @org/security |',
  '| TM-2.1 | §2.1 Framing | external | [Frontend](https://github.com/org/frontend) | @org/frontend |',
  '| TM-2.1b | §2.1 Notifications headers | gap | — | @org/notifications |',
];

function securityGuide({ claims = DEFAULT_CLAIMS, extra = '' } = {}) {
  return `# Security Guide

See the [Threat Model](./threat-model.md).
${extra}

<!-- claims:begin -->
| Claim | Evidence |
|---|---|
${claims.join('\n')}
<!-- claims:end -->
`;
}

const DEFAULT_CLAIMS = [
  '| Releases use provenance | `.github/workflows/release.yml#--provenance` |',
];

const mdx = (md) => md.replace(/<!-- (\w+):(begin|end) -->/g, '{/* $1:$2 */}');

let root;

function write(rel, content) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function writeDocs({ tm = threatModel(), sg = securityGuide() } = {}) {
  write('docs/threat-model.md', tm);
  write('docs/security-guide.md', sg);
  write('packages/docs/content/security/threat-model.mdx', mdx(tm));
  write('packages/docs/content/security/security-guide.mdx', mdx(sg));
}

const rules = () => checkSecurityDocs(root).findings.map((f) => f.rule);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'iln-security-docs-'));
  write('indexer/src/rateLimit.ts', 'export function createApiRateLimiter() {}');
  write('indexer/tests/rateLimit.test.ts', 'test');
  write('.github/workflows/release.yml', 'run: npm publish --provenance');
  write('indexer/src/securityHeaders.ts', HEADERS);
  write('oracle-service/src/securityHeaders.ts', HEADERS);
  write('indexer/src/api.ts', INDEXER_API);
  write('oracle-service/src/index.ts', ORACLE_INDEX);
  writeDocs();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

// ── Success ───────────────────────────────────────────────────────────────────

describe('consistent docs and repository', () => {
  test('pass with no findings', () => {
    const result = checkSecurityDocs(root);
    assert.deepEqual(result.findings, []);
    assert.equal(result.summary.enforced, 1);
    assert.equal(result.summary.external, 1);
    assert.equal(result.summary.gaps, 1);
  });

  test('the real repository passes (regression guard)', () => {
    const result = checkSecurityDocs(repoRoot);
    assert.deepEqual(
      result.findings.map((f) => `[${f.rule}] ${f.file}:${f.line} ${f.message}`),
      []
    );
    assert.ok(result.summary.enforced >= 8, 'real threat model keeps its enforced controls');
  });
});

// ── Failure: each rule fires ──────────────────────────────────────────────────

describe('mitigation table', () => {
  test('an enforced control citing a file that does not exist (the original gap)', () => {
    writeDocs({
      tm: threatModel({
        rows: [
          '| TM-1.1 | §1.1 Dependencies | enforced | `indexer/src/ledger-processor.ts`, `indexer/tests/rateLimit.test.ts` | @org/security |',
          DEFAULT_ROWS[1],
          DEFAULT_ROWS[2],
        ],
      }),
    });
    assert.deepEqual(rules(), [RULES.EVIDENCE_MISSING, RULES.DEAD_PATH]);
  });

  test('an anchor that no longer appears in the cited file', () => {
    write('indexer/src/rateLimit.ts', 'export function renamedLimiter() {}');
    assert.deepEqual(rules(), [RULES.ANCHOR_MISSING]);
  });

  test('an enforced control with no test or workflow behind it', () => {
    writeDocs({
      tm: threatModel({
        rows: [
          '| TM-1.1 | §1.1 Dependencies | enforced | `indexer/src/rateLimit.ts` | @org/security |',
          DEFAULT_ROWS[1],
          DEFAULT_ROWS[2],
        ],
      }),
    });
    assert.deepEqual(rules(), [RULES.NO_PROOF]);
  });

  test('an external control without a link', () => {
    writeDocs({
      tm: threatModel({
        rows: [
          DEFAULT_ROWS[0],
          '| TM-2.1 | §2.1 Framing | external | the frontend repo | @org/frontend |',
          DEFAULT_ROWS[2],
        ],
      }),
    });
    assert.deepEqual(rules(), [RULES.EXTERNAL]);
  });

  test('a gap with no owner, and a gap that claims evidence', () => {
    writeDocs({
      tm: threatModel({
        rows: [
          DEFAULT_ROWS[0],
          DEFAULT_ROWS[1],
          '| TM-2.1b | §2.1 Notifications headers | gap | — | nobody |',
          '| TM-2.1c | §2.1 Something | gap | `indexer/src/rateLimit.ts` | @org/x |',
        ],
      }),
    });
    assert.deepEqual(rules(), [RULES.GAP, RULES.GAP]);
  });

  test('a threat section with no mitigation row', () => {
    writeDocs({
      tm: threatModel({
        sections: '### 1.1 Dependencies\n\n### 2.1 Framing\n\n### 3.1 RPC abuse\n',
      }),
    });
    const result = checkSecurityDocs(root);
    assert.deepEqual(
      result.findings.map((f) => f.rule),
      [RULES.UNCOVERED]
    );
    assert.match(result.findings[0].message, /§3\.1/);
  });

  test('an unknown status, a duplicate id and a malformed row', () => {
    writeDocs({
      tm: threatModel({
        rows: [
          DEFAULT_ROWS[0],
          DEFAULT_ROWS[0],
          '| TM-2.1 | §2.1 Framing | probably | x | @org/a |',
          '| not a row |',
          DEFAULT_ROWS[2],
        ],
      }),
    });
    assert.deepEqual(rules(), [RULES.TABLE, RULES.TABLE, RULES.TABLE]);
  });

  test('missing table markers', () => {
    writeDocs({ tm: '# Threat Model\n\n### 1.1 x\n' });
    assert.ok(rules().includes(RULES.TABLE));
  });
});

describe('claims, paths, headers, ports', () => {
  test('a claim whose file no longer contains the cited text', () => {
    write('.github/workflows/release.yml', 'run: npm publish');
    assert.deepEqual(rules(), [RULES.ANCHOR_MISSING]);
  });

  test('a dead repository path in prose, and a relative link to a missing doc', () => {
    writeDocs({
      sg: securityGuide({ extra: 'Reports live in `contracts/audits/`. See [CI](./ci-cd.md).' }),
    });
    assert.deepEqual(rules(), [RULES.DEAD_PATH, RULES.DEAD_PATH]);
  });

  test('a path explicitly recorded as never having existed is allowed', () => {
    writeDocs({
      tm: threatModel({
        extra: 'An old version cited `indexer/src/ledger-processor.ts`, which never existed.',
      }),
    });
    assert.deepEqual(rules(), []);
  });

  test('security header modules that drift apart', () => {
    write('oracle-service/src/securityHeaders.ts', HEADERS.replace('DENY', 'SAMEORIGIN'));
    assert.deepEqual(rules(), [RULES.HEADERS_DRIFT]);
  });

  test('a service that registers middleware before the security headers', () => {
    write(
      'oracle-service/src/index.ts',
      ORACLE_INDEX.replace(
        "  applySecurityHeaders(app);\n  app.use(express.json({ limit: '256kb' }));",
        "  app.use(express.json({ limit: '256kb' }));\n  applySecurityHeaders(app);"
      )
    );
    assert.deepEqual(rules(), [RULES.HEADERS_ORDER]);
  });

  test('a service that stops registering the headers', () => {
    write('indexer/src/api.ts', INDEXER_API.replace('  applySecurityHeaders(app);\n', ''));
    assert.deepEqual(rules(), [RULES.HEADERS_ORDER]);
  });

  test('a canonical port whose table drifted, and a missing port', () => {
    write(
      'packages/docs/content/security/threat-model.mdx',
      mdx(threatModel({ rows: DEFAULT_ROWS.slice(0, 2) }))
    );
    rmSync(join(root, 'packages/docs/content/security/security-guide.mdx'));
    assert.deepEqual(rules(), [RULES.PORT_DRIFT, RULES.PORT_DRIFT]);
  });
});

// ── Parsers and boundaries ────────────────────────────────────────────────────

describe('parsers', () => {
  test('parseEvidence keeps repository paths and anchors, ignores inline code', () => {
    assert.deepEqual(
      parseEvidence('`indexer/src/a.ts#x y`, `default-src \'none\'`, `package.json#"axios"`'),
      [
        { path: 'indexer/src/a.ts', anchor: 'x y' },
        { path: 'package.json', anchor: '"axios"' },
      ]
    );
  });

  test('extractTable reads both the markdown and the MDX marker forms', () => {
    const md = threatModel();
    assert.equal(extractTable(md, 'mitigations').rows.length, 3);
    assert.equal(extractTable(mdx(md), 'mitigations').rows.length, 3);
    assert.equal(extractTable('no table', 'mitigations'), null);
  });

  test('threatSections ignores headings inside code blocks', () => {
    assert.deepEqual(
      threatSections('### 1.1 Real\n```\n### 9.9 Not a heading\n```\n').map((s) => s.number),
      ['1.1']
    );
  });

  test('mentionedPaths resolves relative links against the document directory', () => {
    const refs = mentionedPaths(
      'See [x](../SECURITY.md) and [y](https://example.com).',
      'docs/a.md'
    );
    assert.deepEqual(
      refs.map((r) => r.path),
      ['SECURITY.md']
    );
  });

  test('the real threat model covers every threat section it defines', () => {
    const md = readFileSync(join(repoRoot, 'docs/threat-model.md'), 'utf8');
    assert.ok(threatSections(md).length >= 9);
  });
});

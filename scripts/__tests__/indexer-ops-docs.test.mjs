import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  TomlError,
  checkIndexerOpsDocs,
  extractDocCommands,
  extractDocHealthStatuses,
  extractDocRoutes,
  extractEnvReads,
  extractHealthStatuses,
  extractRoutes,
  findRoute,
  parseConfigTables,
  parseFlatToml,
} from '../lib/indexer-ops-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── A minimal, fully consistent indexer + docs fixture ────────────────────────

const CONFIG_TS = `
export const CONFIG = {
  port: Number(process.env.PORT ?? '3001'),
  poll: Number(process.env.POLL_INTERVAL_MS ?? '5000'),
  backup: process.env.BACKUP_ENABLED === 'true',
  archive: process.env.ARCHIVE_ENABLED !== 'false',
  redis: process.env.REDIS_URL,
};
`;
const EXPORT_TS = `const rows = positiveNumber(process.env.EXPORT_JOB_MAX, 1_000);`;
const METRICS_TS = `
new Gauge({ name: 'iln_last_processed_ledger', help: 'x' });
new Histogram({ name: 'iln_http_request_duration_seconds', help: 'x' });
`;
const API_TS = `
  app.get('/metrics', h);
  app.use('/docs', swagger);
  router.get('/health', (_req, res) => {
    let dbStatus: 'ok' | 'error' = 'ok';
    res.status(dbStatus === 'ok' ? 200 : 503).json({ status: dbStatus });
  });
  router.get('/invoice/:id', h);
  router.post('/export/jobs', h);
  router.get('/export/invoices', h);
`;
const PACKAGE_JSON = JSON.stringify({
  name: 'iln-indexer',
  scripts: { build: 'tsc', start: 'node dist/index.js', dev: 'tsx watch src/index.ts' },
  devDependencies: { tsx: '^4' },
});
const CONFIGURATION_MD = `# Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| \`PORT\` | \`3001\` | HTTP port |
| \`POLL_INTERVAL_MS\` | \`5_000\` | Poll interval |
| \`BACKUP_ENABLED\` | \`false\` | Backups |
| \`ARCHIVE_ENABLED\` | \`true\` | Archival |
| \`REDIS_URL\` | - | Redis |
| \`EXPORT_JOB_MAX\` | \`1000\` | Jobs |

\`\`\`env
PORT=3001
REDIS_URL=redis://localhost:6379
\`\`\`
`;
const OPS_MD = `# Operations

Check \`GET /v1/health\` and \`GET /invoice/7\`; exports live under \`GET /export/*\`.

\`\`\`bash
curl http://localhost:3001/v1/health   # {"status": "ok"}, 503 with "error"
pnpm --filter iln-indexer build
pnpm --filter iln-indexer exec tsx -e "1"
npm start
\`\`\`

Watch \`iln_last_processed_ledger\` and \`iln_http_request_duration_seconds_bucket\`.
`;
const RAILWAY_TOML = `[build]
buildCommand = "corepack pnpm --filter iln-indexer build"

[deploy]
startCommand = "corepack pnpm --filter iln-indexer start"
numReplicas = 1
healthcheckPath = "/v1/health"

[variables]
PORT = "3001"
`;

let root;

function write(rel, content) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function check() {
  return checkIndexerOpsDocs(root);
}

const rulesOf = (result) => result.findings.map((f) => f.rule);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'iln-indexer-ops-docs-'));
  write('indexer/src/config.ts', CONFIG_TS);
  write('indexer/src/export.ts', EXPORT_TS);
  write('indexer/src/metrics.ts', METRICS_TS);
  write('indexer/src/api.ts', API_TS);
  write('indexer/src/config.test.ts', 'process.env.TEST_ONLY_VAR = "x";');
  write('indexer/package.json', PACKAGE_JSON);
  write('indexer/railway.toml', RAILWAY_TOML);
  write('docs/indexer/configuration.md', CONFIGURATION_MD);
  write('docs/indexer/operations.md', OPS_MD);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

// ── Success ───────────────────────────────────────────────────────────────────

describe('consistent docs and code', () => {
  test('pass with no findings', () => {
    const result = check();
    assert.deepEqual(result.findings, []);
    assert.equal(result.summary.ok, true);
    assert.equal(result.summary.envVarsRead, 6);
    assert.equal(result.summary.envVarsDocumented, 6);
  });

  test('the real repository passes (regression guard for docs/indexer)', () => {
    const result = checkIndexerOpsDocs(repoRoot);
    assert.deepEqual(
      result.findings.map((f) => `[${f.rule}] ${f.file}:${f.line} ${f.message}`),
      []
    );
  });
});

// ── Failure: each rule fires ──────────────────────────────────────────────────

describe('configuration.md ↔ code', () => {
  test('a variable the code reads but the docs omit', () => {
    write('indexer/src/extra.ts', 'const x = process.env.CONFIRMATION_DEPTH ?? "10";');
    const result = check();
    assert.deepEqual(rulesOf(result), [RULES.ENV_UNDOCUMENTED]);
    assert.match(result.findings[0].message, /CONFIRMATION_DEPTH/);
    assert.equal(result.findings[0].file, 'indexer/src/extra.ts');
  });

  test('a documented variable no code reads', () => {
    write(
      'docs/indexer/configuration.md',
      CONFIGURATION_MD.replace(
        '| `REDIS_URL` | - | Redis |',
        '| `REDIS_URL` | - | Redis |\n| `SQLITE_WAL_MODE` | `true` | WAL |'
      )
    );
    assert.deepEqual(rulesOf(check()), [RULES.ENV_NOT_READ]);
  });

  test('a documented default that differs from the code default', () => {
    write(
      'docs/indexer/configuration.md',
      CONFIGURATION_MD.replace('| `3001` | HTTP port', '| `8080` | HTTP port')
    );
    const result = check();
    assert.deepEqual(rulesOf(result), [RULES.ENV_DEFAULT_MISMATCH]);
    assert.match(result.findings[0].message, /"8080".*"3001"/);
  });

  test('a later table that only mentions a variable does not hide its documented default', () => {
    write(
      'indexer/src/config.ts',
      CONFIG_TS.replace("process.env.PORT ?? '3001'", "process.env.PORT ?? '3000'")
    );
    write(
      'docs/indexer/configuration.md',
      `${CONFIGURATION_MD}\n## Startup validation\n\n| Variable | Range |\n|---|---|\n| \`PORT\` | 1 – 65535 |\n`
    );
    const result = check();
    assert.deepEqual(rulesOf(result), [RULES.ENV_DEFAULT_MISMATCH]);
    assert.match(result.findings[0].message, /PORT/);
  });

  test('boolean defaults are derived from the comparison the code makes', () => {
    // BACKUP_ENABLED === 'true' → off by default; documenting `true` is wrong.
    write(
      'docs/indexer/configuration.md',
      CONFIGURATION_MD.replace('| `false` | Backups', '| `true` | Backups')
    );
    assert.deepEqual(rulesOf(check()), [RULES.ENV_DEFAULT_MISMATCH]);
  });

  test('test files do not count as indexer configuration', () => {
    assert.ok(!check().findings.some((f) => f.message.includes('TEST_ONLY_VAR')));
  });

  test('an env assignment in any ops doc for a variable the indexer never reads', () => {
    write('docs/indexer/operations.md', `${OPS_MD}\n\`\`\`env\nSQLITE_WAL_MODE=true\n\`\`\`\n`);
    assert.deepEqual(rulesOf(check()), [RULES.ENV_REFERENCE_UNKNOWN]);
  });
});

describe('endpoints, metrics, commands, health', () => {
  test('an endpoint that does not exist', () => {
    write('docs/indexer/operations.md', `${OPS_MD}\nCall \`POST /backup/restore\`.\n`);
    const result = check();
    assert.deepEqual(rulesOf(result), [RULES.ROUTE_UNKNOWN]);
    assert.match(result.findings[0].message, /POST \/backup\/restore/);
  });

  test('the wrong method for an existing path', () => {
    write('docs/indexer/operations.md', `${OPS_MD}\nCall \`GET /export/jobs\`.\n`);
    assert.deepEqual(rulesOf(check()), [RULES.ROUTE_UNKNOWN]);
  });

  test('a metric name the indexer never exports', () => {
    write(
      'docs/indexer/operations.md',
      `${OPS_MD}\nAlert when \`indexer_last_processed_ledger\` lags.\n`
    );
    assert.deepEqual(rulesOf(check()), [RULES.METRIC_UNKNOWN]);
  });

  test('a script or binary that does not exist', () => {
    write(
      'docs/indexer/operations.md',
      `${OPS_MD}\n\`pnpm --filter iln-indexer exec ts-node -e 1\`\n\`npm run migrate\`\n`
    );
    assert.deepEqual(rulesOf(check()), [RULES.COMMAND_UNKNOWN, RULES.COMMAND_UNKNOWN]);
  });

  test('a binary from the workspace root counts (pnpm exec walks up)', () => {
    write('package.json', JSON.stringify({ devDependencies: { 'ts-node': '^10' } }));
    write(
      'docs/indexer/operations.md',
      `${OPS_MD}\n\`pnpm --filter iln-indexer exec ts-node -e 1\`\n`
    );
    assert.deepEqual(check().findings, []);
  });

  test('a /health status the handler can never return', () => {
    write(
      'docs/indexer/operations.md',
      `${OPS_MD}\n## Health\n\nA broken DB reports \`"degraded"\`.\n`
    );
    const result = check();
    assert.deepEqual(rulesOf(result), [RULES.HEALTH_CONTRACT]);
    assert.match(result.findings[0].message, /"degraded".*"ok" or "error"/);
  });
});

describe('railway.toml', () => {
  test('a duplicate key makes the file invalid (Railway rejects it)', () => {
    write(
      'indexer/railway.toml',
      RAILWAY_TOML.replace('numReplicas = 1', 'numReplicas = 1\nnumReplicas = 2')
    );
    const result = check();
    assert.deepEqual(rulesOf(result), [RULES.DEPLOY_CONFIG]);
    assert.match(result.findings[0].message, /duplicate key "numReplicas"/);
  });

  test('a health check path that is not a route', () => {
    write('indexer/railway.toml', RAILWAY_TOML.replace('/v1/health', '/healthz'));
    assert.deepEqual(rulesOf(check()), [RULES.DEPLOY_CONFIG]);
  });

  test('a start command for a missing script, and a variable nothing reads', () => {
    write(
      'indexer/railway.toml',
      RAILWAY_TOML.replace('iln-indexer start', 'iln-indexer serve').replace(
        'PORT = "3001"',
        'PORT = "3001"\nSQLITE_WAL_MODE = "true"'
      )
    );
    assert.deepEqual(rulesOf(check()), [RULES.DEPLOY_CONFIG, RULES.DEPLOY_CONFIG]);
  });
});

// ── Boundaries and parsers ────────────────────────────────────────────────────

describe('parsers', () => {
  test('parseFlatToml handles comments, types and rejects duplicates', () => {
    assert.deepEqual(
      parseFlatToml('# c\n[deploy]\nnumReplicas = 1 # one\nname = "a # b"\non = true\n'),
      { deploy: { numReplicas: 1, name: 'a # b', on: true } }
    );
    assert.throws(() => parseFlatToml('[a]\n[a]\n'), TomlError);
    assert.throws(() => parseFlatToml('[a]\nx = [1, 2]\n'), TomlError);
  });

  test('parseConfigTables finds the Default column by header', () => {
    const vars = parseConfigTables(
      '| Variable | Type | Description |\n|---|---|---|\n| `CONTRACT_ID` | string | x |\n\n' +
        '| Variable | Default | Description |\n|---|---|---|\n| `PORT` | `3001` | y |\n| `REDIS_URL` | - | z |\n'
    );
    assert.deepEqual(
      [...vars.entries()].map(([k, v]) => [k, v.default]),
      [
        ['CONTRACT_ID', undefined],
        ['PORT', '3001'],
        ['REDIS_URL', null],
      ]
    );
  });

  test('extractEnvReads keeps the first statically known default', () => {
    const reads = extractEnvReads([
      { file: 'a.ts', text: 'process.env.X;\nconst y = process.env.X ?? "7";' },
    ]);
    assert.equal(reads.get('X').default, '7');
    assert.equal(reads.get('X').line, 1);
  });

  test('routes: router paths are served at / and /v1; params and wildcards match', () => {
    const routes = extractRoutes(API_TS);
    assert.ok(findRoute(routes, 'GET', '/v1/invoice/123'));
    assert.ok(findRoute(routes, 'GET', '/invoice/:id'));
    assert.ok(findRoute(routes, 'POST', '/export/*'));
    assert.ok(findRoute(routes, 'GET', '/docs/index.html'));
    assert.equal(findRoute(routes, 'GET', '/invoice'), null);
    assert.equal(findRoute(routes, 'GET', '/v2/health'), null);
  });

  test('extractDocRoutes trims punctuation and ignores the bare root', () => {
    assert.deepEqual(
      extractDocRoutes('See `GET /stats`. Or curl http://localhost:3001/ now.').map((r) => r.path),
      ['/stats']
    );
  });

  test('extractDocCommands only reads code', () => {
    assert.deepEqual(extractDocCommands('Run npm run build in prose.'), []);
    assert.equal(extractDocCommands('Run `npm run build`.').length, 1);
  });

  test('health statuses come from the handler type, docs from health context only', () => {
    assert.deepEqual([...extractHealthStatuses(API_TS)], ['ok', 'error']);
    assert.deepEqual(
      extractDocHealthStatuses('# Cache\nReturns "ok".\n# Health\nReturns `"degraded"`.\n').map(
        (r) => r.status
      ),
      ['degraded']
    );
  });
});

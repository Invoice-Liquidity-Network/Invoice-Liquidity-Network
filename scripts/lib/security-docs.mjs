/**
 * scripts/lib/security-docs.mjs
 *
 * Executable checks for the security guide and threat model (#1287).
 *
 * Both documents stated controls as current that were not: the threat model
 * cited three implementation files that never existed and a ledger-hash check
 * nothing performs, and listed frontend CSP as a mitigation in a repository
 * that has no frontend source (it is a submodule). This module verifies the
 * claims instead of trusting them:
 *
 *   - mitigation table (threat-model.md): every row is enforced (evidence
 *     exists, anchors match, a test or workflow proves it), external (linked
 *     to where it lives), or an owned gap — and every threat section is covered;
 *   - claims table (security-guide.md): every cited file exists and contains
 *     the cited text;
 *   - every repository path either document mentions exists;
 *   - the HTTP security-header middleware is identical in every service and
 *     registered before anything else in each app;
 *   - the canonical-site ports carry the same tables as their sources.
 *
 * Dependency-free: plain Node. Every finding is { rule, file, line, message }.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RULES = {
  TABLE: 'table-format',
  EVIDENCE_MISSING: 'evidence-missing',
  ANCHOR_MISSING: 'anchor-missing',
  NO_PROOF: 'no-test-or-workflow',
  EXTERNAL: 'external-without-link',
  GAP: 'gap-without-owner',
  UNCOVERED: 'threat-uncovered',
  DEAD_PATH: 'dead-path',
  HEADERS_DRIFT: 'headers-drift',
  HEADERS_ORDER: 'headers-not-first',
  PORT_DRIFT: 'port-drift',
};

export const THREAT_MODEL = 'docs/threat-model.md';
export const SECURITY_GUIDE = 'docs/security-guide.md';

/** Canonical-site ports of the two documents. */
export const PORTS = {
  [THREAT_MODEL]: 'packages/docs/content/security/threat-model.mdx',
  [SECURITY_GUIDE]: 'packages/docs/content/security/security-guide.mdx',
};

/** Services that must send the security headers, and the app factory file. */
export const HEADER_SERVICES = [
  {
    module: 'indexer/src/securityHeaders.ts',
    app: 'indexer/src/api.ts',
    factory: 'export function createApp',
  },
  {
    module: 'oracle-service/src/securityHeaders.ts',
    app: 'oracle-service/src/index.ts',
    factory: 'export async function createOracleApp',
  },
];

const STATUSES = new Set(['enforced', 'external', 'gap']);
const OWNER = /@[A-Za-z0-9-]+\/[A-Za-z0-9-]+/;

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Rows of the markdown table between `<!-- name:begin -->` and
 * `<!-- name:end -->` (or the MDX form `{/* name:begin *\/}`, since MDX 3 has
 * no HTML comments).
 */
export function extractTable(markdown, name) {
  const isMarker = (line, edge) =>
    line === `<!-- ${name}:${edge} -->` || line === `{/* ${name}:${edge} */}`;
  const lines = markdown.split('\n');
  const from = lines.findIndex((l) => isMarker(l.trim(), 'begin'));
  const to = lines.findIndex((l) => isMarker(l.trim(), 'end'));
  if (from < 0 || to < 0 || to < from) return null;
  const rows = [];
  for (let i = from + 1; i < to; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const cells = line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push({ cells, line: i + 1, raw: line });
  }
  // First row is the header.
  return { header: rows[0]?.cells ?? [], rows: rows.slice(1) };
}

/**
 * Evidence references in a cell: backticked `path` or `path#anchor`. Only
 * repository paths count (a `/` or a known root file), so inline code such
 * as `default-src 'none'` is not mistaken for evidence.
 */
export function parseEvidence(cell) {
  const refs = [];
  for (const m of cell.matchAll(/`([^`]+)`/g)) {
    const text = m[1];
    const hash = text.indexOf('#');
    const path = hash < 0 ? text : text.slice(0, hash);
    const anchor = hash < 0 ? null : text.slice(hash + 1);
    if (!isRepoPath(path)) continue;
    refs.push({ path, anchor });
  }
  return refs;
}

const ROOT_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'codecov.yml',
  'SECURITY.md',
  'HALL_OF_FAME.md',
  'turbo.json',
  'knip.json',
]);

function isRepoPath(text) {
  if (/\s/.test(text) || text.startsWith('@') || /^https?:/.test(text)) return false;
  if (ROOT_FILES.has(text)) return true;
  return /^(\.github|docs|scripts|indexer|oracle-service|notifications|packages|sdk|cli|contracts|backend|frontend|workers|tests)\//.test(
    text
  );
}

const isProof = (path) =>
  /\.test\.(m?[jt]sx?|cjs)$/.test(path) ||
  /(^|\/)__tests__\//.test(path) ||
  /^\.github\/workflows\//.test(path) ||
  /^indexer\/tests\//.test(path);

/** `### N.M Title` sections of the threat model, by number. */
export function threatSections(markdown) {
  const sections = [];
  let inCode = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const m = !inCode && /^###\s+(\d+\.\d+)\s+(.+)$/.exec(line);
    if (m) sections.push({ number: m[1], title: m[2].trim() });
  }
  return sections;
}

/**
 * Repository paths a document mentions: relative markdown links to files and
 * backticked repository paths outside the machine-checked tables.
 */
export function mentionedPaths(markdown, docPath) {
  const refs = [];
  const docDir = docPath.split('/').slice(0, -1).join('/');
  let inCode = false;
  markdown.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    for (const m of line.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      refs.push({ path: normalize(`${docDir}/${target}`), line: i + 1, raw: target, text: line });
    }
    for (const m of line.matchAll(/`([^`#\s]+)(#[^`]*)?`/g)) {
      if (isRepoPath(m[1]) && /[./]/.test(m[1].slice(-6))) {
        refs.push({ path: m[1].replace(/\/$/, ''), line: i + 1, raw: m[1], text: line });
      }
    }
  });
  return refs;
}

function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

// ── Checks ───────────────────────────────────────────────────────────────────

function fileText(root, path) {
  const full = join(root, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

function checkEvidence(root, doc, row, refs, report) {
  for (const { path, anchor } of refs) {
    const text = fileText(root, path);
    if (text === null) {
      report(RULES.EVIDENCE_MISSING, doc, row.line, `${path} does not exist`);
      continue;
    }
    if (anchor && !text.includes(anchor)) {
      report(RULES.ANCHOR_MISSING, doc, row.line, `${path} does not contain "${anchor}"`);
    }
  }
}

export function checkMitigations(root, report) {
  const doc = THREAT_MODEL;
  const markdown = fileText(root, doc);
  if (markdown === null) {
    report(RULES.TABLE, doc, 0, 'threat model not found');
    return { rows: 0 };
  }
  const table = extractTable(markdown, 'mitigations');
  if (!table) {
    report(RULES.TABLE, doc, 0, 'mitigations table markers not found');
    return { rows: 0 };
  }
  const ids = new Set();
  const covered = new Set();
  const counts = { enforced: 0, external: 0, gap: 0 };
  for (const row of table.rows) {
    const [id, threat, status, evidence, owner] = row.cells;
    if (row.cells.length !== 5 || !/^TM-\d+\.\d+[a-z]?$/.test(id ?? '')) {
      report(RULES.TABLE, doc, row.line, `malformed row: ${row.raw.slice(0, 80)}`);
      continue;
    }
    if (ids.has(id)) report(RULES.TABLE, doc, row.line, `${id} is listed twice`);
    ids.add(id);
    if (!STATUSES.has(status)) {
      report(
        RULES.TABLE,
        doc,
        row.line,
        `${id}: status must be enforced, external or gap — got "${status}"`
      );
      continue;
    }
    counts[status] += 1;
    for (const m of threat.matchAll(/§(\d+\.\d+)/g)) covered.add(m[1]);
    if (!OWNER.test(owner ?? '')) {
      report(RULES.GAP, doc, row.line, `${id}: an owner (@org/team) is required`);
    }
    const refs = parseEvidence(evidence);
    if (status === 'enforced') {
      if (refs.length === 0)
        report(RULES.EVIDENCE_MISSING, doc, row.line, `${id}: enforced but cites no evidence`);
      else if (!refs.some((r) => isProof(r.path))) {
        report(
          RULES.NO_PROOF,
          doc,
          row.line,
          `${id}: enforced but no test or CI workflow is cited`
        );
      }
      checkEvidence(root, doc, row, refs, report);
    } else if (status === 'external') {
      if (!/\]\(https:\/\/[^)]+\)/.test(evidence)) {
        report(
          RULES.EXTERNAL,
          doc,
          row.line,
          `${id}: external controls must link to where they live`
        );
      }
      checkEvidence(root, doc, row, refs, report);
    } else if (refs.length > 0) {
      report(
        RULES.GAP,
        doc,
        row.line,
        `${id}: a gap cannot claim evidence — enforce it or remove the paths`
      );
    }
  }
  for (const section of threatSections(markdown)) {
    if (!covered.has(section.number)) {
      report(
        RULES.UNCOVERED,
        doc,
        0,
        `§${section.number} "${section.title}" has no mitigation row`
      );
    }
  }
  return { rows: table.rows.length, ...counts };
}

export function checkClaims(root, report) {
  const doc = SECURITY_GUIDE;
  const markdown = fileText(root, doc);
  const table = markdown && extractTable(markdown, 'claims');
  if (!table) {
    report(RULES.TABLE, doc, 0, 'claims table markers not found');
    return { claims: 0 };
  }
  for (const row of table.rows) {
    const refs = parseEvidence(row.cells[1] ?? '');
    if (row.cells.length !== 2 || refs.length === 0) {
      report(RULES.TABLE, doc, row.line, `claim cites no evidence: ${row.raw.slice(0, 80)}`);
      continue;
    }
    checkEvidence(root, doc, row, refs, report);
  }
  return { claims: table.rows.length };
}

export function checkMentionedPaths(root, report) {
  let checked = 0;
  for (const doc of [THREAT_MODEL, SECURITY_GUIDE]) {
    const markdown = fileText(root, doc);
    if (markdown === null) continue;
    for (const ref of mentionedPaths(markdown, doc)) {
      checked += 1;
      if (!existsSync(join(root, ref.path)) && !ref.text.includes(HISTORICAL_MARKER)) {
        report(RULES.DEAD_PATH, doc, ref.line, `${ref.raw} → ${ref.path} does not exist`);
      }
    }
  }
  return { paths: checked };
}

/**
 * A missing path is allowed only on a line that says, in so many words, that
 * it never existed — so the threat model can record which cited files were
 * fictional without the record itself failing, while the same names presented
 * as current implementations still fail.
 */
export const HISTORICAL_MARKER = 'never existed';

export function checkHeaders(root, report) {
  const modules = HEADER_SERVICES.map((s) => ({ ...s, text: fileText(root, s.module) }));
  const [canonical] = modules;
  for (const m of modules) {
    if (m.text === null) {
      report(RULES.HEADERS_DRIFT, m.module, 0, 'security headers module is missing');
      continue;
    }
    if (canonical.text !== null && m.text !== canonical.text) {
      report(
        RULES.HEADERS_DRIFT,
        m.module,
        0,
        `differs from ${canonical.module}; keep the copies identical`
      );
    }
    const app = fileText(root, m.app);
    if (app === null) {
      report(RULES.HEADERS_ORDER, m.app, 0, 'app file not found');
      continue;
    }
    const start = app.indexOf(m.factory);
    if (start < 0) {
      report(RULES.HEADERS_ORDER, m.app, 0, `"${m.factory}" not found`);
      continue;
    }
    const body = app.slice(start);
    const apply = body.indexOf('applySecurityHeaders(app)');
    const firstUse = body.search(/\bapp\.(use|get|post|put|patch|delete|all)\(/);
    const line = app.slice(0, start + Math.max(apply, 0)).split('\n').length;
    if (apply < 0) {
      report(RULES.HEADERS_ORDER, m.app, 0, `${m.factory} does not call applySecurityHeaders(app)`);
    } else if (firstUse >= 0 && firstUse < apply) {
      report(
        RULES.HEADERS_ORDER,
        m.app,
        line,
        'applySecurityHeaders(app) must run before any other middleware or route'
      );
    }
  }
  return { services: modules.length };
}

export function checkPorts(root, report) {
  for (const [source, port] of Object.entries(PORTS)) {
    const src = fileText(root, source);
    const dst = fileText(root, port);
    if (dst === null) {
      report(RULES.PORT_DRIFT, port, 0, `canonical port of ${source} is missing`);
      continue;
    }
    for (const name of ['mitigations', 'claims']) {
      const a = src && extractTable(src, name);
      if (!a) continue;
      const b = extractTable(dst, name);
      const same =
        b &&
        JSON.stringify(a.rows.map((r) => r.cells)) === JSON.stringify(b.rows.map((r) => r.cells));
      if (!same) report(RULES.PORT_DRIFT, port, 0, `${name} table differs from ${source}`);
    }
  }
}

export function checkSecurityDocs(root) {
  const findings = [];
  const report = (rule, file, line, message) => findings.push({ rule, file, line, message });
  const mitigations = checkMitigations(root, report);
  const claims = checkClaims(root, report);
  const paths = checkMentionedPaths(root, report);
  const headers = checkHeaders(root, report);
  checkPorts(root, report);
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  return {
    findings,
    summary: {
      ok: findings.length === 0,
      total: findings.length,
      byRule,
      mitigationRows: mitigations.rows,
      enforced: mitigations.enforced ?? 0,
      external: mitigations.external ?? 0,
      gaps: mitigations.gap ?? 0,
      claims: claims.claims,
      pathsChecked: paths.paths,
      headerServices: headers.services,
    },
  };
}

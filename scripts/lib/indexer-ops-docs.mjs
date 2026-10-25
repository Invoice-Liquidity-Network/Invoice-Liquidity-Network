/**
 * scripts/lib/indexer-ops-docs.mjs
 *
 * Executable checks for the indexer operations documentation (#1288).
 *
 * The operator docs under docs/indexer/ make concrete claims — environment
 * variables and their defaults, HTTP endpoints, Prometheus metric names,
 * commands, and the Railway deployment config. Prose cannot keep up with code
 * on its own (the docs claimed startup validation that did not exist, a
 * `/health` "degraded" response the code never returned, and a metric name
 * that was never exported), so each claim is checked here against the
 * indexer source. Dependency-free: plain Node, no install required.
 *
 * Every finding is `{ rule, file, line, message }`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const RULES = {
  ENV_UNDOCUMENTED: 'env-undocumented',
  ENV_NOT_READ: 'env-not-read',
  ENV_DEFAULT_MISMATCH: 'env-default-mismatch',
  ENV_REFERENCE_UNKNOWN: 'env-reference-unknown',
  ROUTE_UNKNOWN: 'route-unknown',
  METRIC_UNKNOWN: 'metric-unknown',
  COMMAND_UNKNOWN: 'command-unknown',
  DEPLOY_CONFIG: 'deploy-config',
  HEALTH_CONTRACT: 'health-contract',
};

/** Variables that may appear in operator docs without being indexer config. */
const NON_CONFIG_ALLOWLIST = new Set([
  'TARGET_LEDGER', // placeholder in the cursor-reset runbook command
  'YOUR_CONTRACT_ID',
  'YOUR_MAINNET_CONTRACT_ID',
  'YOUR_RPC_URL',
  'SQLITE_BUSY', // SQLite error code
  'BATCH_SIZE', // poller constant, discussed in troubleshooting
  'API_KEY',
]);

// ── Source extraction ───────────────────────────────────────────────────────

/** Normalise a numeric literal like `200_000` or `'5000'` to a canonical string. */
function literal(raw) {
  if (raw === undefined) return null;
  const s = raw.trim();
  const quoted = /^(['"`])(.*)\1$/.exec(s);
  if (quoted) return quoted[2];
  if (/^[\d_]+$/.test(s)) return s.replace(/_/g, '');
  return null;
}

/**
 * Environment variables read by indexer source, with the default the code
 * falls back to when it can be determined statically (else null).
 *
 * @param {Array<{file: string, text: string}>} sources
 * @returns {Map<string, {default: string|null, file: string, line: number}>}
 */
export function extractEnvReads(sources) {
  const reads = new Map();
  const patterns = [
    // process.env.X ?? 'd'   |  process.env.X || 'd'
    {
      re: /process\.env\.([A-Z][A-Z0-9_]*)\s*(?:\?\?|\|\|)\s*('[^']*'|"[^"]*"|[\d_]+)/g,
      def: (m) => literal(m[2]),
    },
    // process.env.X === 'true'  → default false ; process.env.X !== 'false' → default true
    { re: /process\.env\.([A-Z][A-Z0-9_]*)\s*===\s*'true'/g, def: () => 'false' },
    { re: /process\.env\.([A-Z][A-Z0-9_]*)\s*!==\s*'false'/g, def: () => 'true' },
    // positiveNumber(process.env.X, 200_000)
    {
      re: /\w+\(\s*process\.env\.([A-Z][A-Z0-9_]*)\s*,\s*([\d_]+)\s*\)/g,
      def: (m) => literal(m[2]),
    },
    // any other read
    { re: /process\.env\.([A-Z][A-Z0-9_]*)/g, def: () => null },
  ];
  for (const { file, text } of sources) {
    for (const { re, def } of patterns) {
      for (const m of text.matchAll(re)) {
        const name = m[1];
        const line = text.slice(0, m.index).split('\n').length;
        const existing = reads.get(name);
        const value = def(m);
        if (!existing) {
          reads.set(name, { default: value, file, line });
          continue;
        }
        if (existing.default === null && value !== null) existing.default = value;
        // Report the first place the variable is read.
        if (existing.file === file && line < existing.line) existing.line = line;
      }
    }
  }
  return reads;
}

/** Registered Prometheus metric names (`name: 'iln_…'`). */
export function extractMetricNames(metricsSource) {
  return new Set(
    [...metricsSource.matchAll(/name:\s*['"]([a-z_][a-z0-9_]*)['"]/g)].map((m) => m[1])
  );
}

/**
 * HTTP routes served by the indexer. Router routes are mounted at both `/`
 * and `/v1` (see the bottom of createApp in indexer/src/api.ts).
 */
export function extractRoutes(apiSource, extraMounts = ['/graphql']) {
  const routes = [];
  const add = (method, path) => routes.push({ method, path });
  for (const m of apiSource.matchAll(
    /\brouter\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g
  )) {
    add(m[1].toUpperCase(), m[2]);
    add(m[1].toUpperCase(), `/v1${m[2]}`);
  }
  for (const m of apiSource.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
    add(m[1].toUpperCase(), m[2]);
  }
  for (const m of apiSource.matchAll(/\bapp\.use\(\s*['"]([^'"]+)['"]/g)) add('ANY', m[1]);
  for (const mount of extraMounts) add('ANY', mount);
  return routes;
}

function routeMatches(route, method, path) {
  if (route.method !== 'ANY' && method && route.method !== method) return false;
  const want = path.split('/').filter(Boolean);
  const have = route.path.split('/').filter(Boolean);
  if (route.method === 'ANY') {
    // Mounted handlers (GraphQL, Swagger UI) serve everything under the prefix.
    return have.every((seg, i) => want[i] === seg);
  }
  // `/export/*` in prose means "any route under /export".
  if (want.at(-1) === '*') {
    const prefix = want.slice(0, -1);
    return have.length > prefix.length && prefix.every((seg, i) => have[i] === seg);
  }
  if (want.length !== have.length) return false;
  return have.every((seg, i) => seg.startsWith(':') || /^[:{<]/.test(want[i]) || seg === want[i]);
}

export function findRoute(routes, method, path) {
  return routes.find((r) => routeMatches(r, method, path)) ?? null;
}

// ── Docs extraction ─────────────────────────────────────────────────────────

/**
 * Environment-variable tables in configuration.md: rows whose first cell is a
 * backticked UPPER_CASE name. The "Default" column is located by header, so
 * tables without one (e.g. "Required") yield `default: undefined`.
 *
 * @returns {Map<string, {default: string|undefined, line: number}>}
 */
export function parseConfigTables(markdown) {
  const vars = new Map();
  const lines = markdown.split('\n');
  let defaultCol = -1;
  let isReference = false;
  let inCode = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inCode = !inCode;
    if (inCode || !line.trim().startsWith('|')) {
      if (!line.trim().startsWith('|')) {
        defaultCol = -1;
        isReference = false;
      }
      return;
    }
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) return;
    if (/^variable$/i.test(cells[0])) {
      // Only variable reference tables (with a Description column) define
      // variables; other tables (e.g. validation ranges) merely mention them.
      isReference = cells.some((c) => /^description$/i.test(c));
      defaultCol = cells.findIndex((c) => /^default$/i.test(c));
      return;
    }
    const name = /^`([A-Z][A-Z0-9_]*)`$/.exec(cells[0]);
    if (!name || !isReference || vars.has(name[1])) return;
    let def;
    if (defaultCol >= 0) {
      const cell = cells[defaultCol] ?? '';
      const ticked = /^`([^`]*)`$/.exec(cell);
      def = ticked ? ticked[1] : cell === '-' || cell === '—' || cell === '' ? null : cell;
    }
    vars.set(name[1], { default: def, line: i + 1 });
  });
  return vars;
}

/** Yield `{ text, line, inCode }` for every line of a markdown document. */
function* markdownLines(markdown) {
  let inCode = false;
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode;
      continue;
    }
    yield { text: line, line: i + 1, inCode };
  }
}

/** HTTP paths referenced by a doc: `GET /path`, `curl …:3001/path`, `/v1/...` in code. */
export function extractDocRoutes(markdown) {
  const refs = [];
  for (const { text, line } of markdownLines(markdown)) {
    for (const m of text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9/_:{}<>.*-]*)/g)) {
      refs.push({ method: m[1], path: m[2], line });
    }
    for (const m of text.matchAll(
      /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|indexer):\d+(\/[A-Za-z0-9/_:.-]*)/g
    )) {
      refs.push({ method: null, path: m[1], line });
    }
  }
  return refs
    .map((r) => ({ ...r, path: r.path.replace(/[.]+$/, '').replace(/\/+$/, '') || '/' }))
    .filter((r) => r.path !== '/');
}

/** Metric-looking identifiers: `iln_*` and `indexer_*` snake_case tokens. */
export function extractDocMetrics(markdown) {
  const refs = [];
  for (const { text, line } of markdownLines(markdown)) {
    for (const m of text.matchAll(/\b((?:iln|indexer)_[a-z0-9_]+)\b/g)) {
      refs.push({ name: m[1], line });
    }
  }
  return refs;
}

/** `VAR=value` assignments in docs (env files, shell, Dockerfile ENV). */
export function extractDocEnvAssignments(markdown) {
  const refs = [];
  for (const { text, line } of markdownLines(markdown)) {
    for (const m of text.matchAll(/(?:^|[\s"'`]|ENV\s+)([A-Z][A-Z0-9]*_[A-Z0-9_]+|PORT)=/g)) {
      refs.push({ name: m[1], line });
    }
  }
  return refs;
}

/** pnpm/npm invocations that target the indexer package. */
export function extractDocCommands(markdown) {
  const refs = [];
  for (const { text, line, inCode } of markdownLines(markdown)) {
    if (!inCode && !text.includes('`')) continue;
    for (const m of text.matchAll(
      /pnpm\s+--filter\s+(?:iln-indexer|\.\/indexer)\s+(exec\s+)?([a-z][\w:-]*)/g
    )) {
      refs.push({ kind: m[1] ? 'bin' : 'script', name: m[2], line, text: m[0] });
    }
    for (const m of text.matchAll(/\b(?:npm|pnpm)\s+run\s+([a-z][\w:-]*)/g)) {
      refs.push({ kind: 'script', name: m[1], line, text: m[0] });
    }
    for (const m of text.matchAll(/\b(?:npm|pnpm)\s+(start|test)\b/g)) {
      refs.push({ kind: 'script', name: m[1], line, text: m[0] });
    }
  }
  return refs;
}

/**
 * Status values the `/health` handler can return, read from the handler's
 * status type annotation (e.g. `let dbStatus: 'ok' | 'error'`).
 */
export function extractHealthStatuses(apiSource) {
  const start = apiSource.search(/router\.get\(\s*['"]\/health['"]/);
  if (start < 0) return new Set();
  const end = apiSource.indexOf('\n  });', start);
  const block = apiSource.slice(start, end < 0 ? undefined : end);
  const union = /Status\s*:\s*((?:['"][a-z]+['"]\s*\|?\s*)+)/.exec(block);
  return new Set(union ? [...union[1].matchAll(/['"]([a-z]+)['"]/g)].map((m) => m[1]) : []);
}

/** Words that denote a health state; only these are compared, so prose is ignored. */
const HEALTH_WORDS = /["'`](ok|error|degraded|healthy|unhealthy|down|up|failing)["'`]/g;

/**
 * Health status values a doc claims, from lines that mention health and from
 * the section that follows a `/health` reference (until the next heading).
 */
export function extractDocHealthStatuses(markdown) {
  const refs = [];
  let inSection = false;
  for (const { text, line, inCode } of markdownLines(markdown)) {
    if (!inCode && /^#{1,6}\s/.test(text)) inSection = /health/i.test(text);
    if (/\/health\b/.test(text)) inSection = true;
    if (!inSection && !/health/i.test(text)) continue;
    for (const m of text.matchAll(HEALTH_WORDS)) refs.push({ status: m[1], line });
  }
  return refs;
}

// ── Minimal strict TOML (for railway.toml) ──────────────────────────────────

/** Remove a `#` comment that is not inside a double-quoted string. */
function stripTomlComment(raw) {
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && inString) i++;
    else if (ch === '"') inString = !inString;
    else if (ch === '#' && !inString) return raw.slice(0, i);
  }
  return raw;
}

export class TomlError extends Error {
  constructor(line, message) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

/**
 * Parse the flat TOML subset used by railway.toml: `[table]` headers and
 * `key = "string" | number | true/false`. Rejects duplicate keys and tables
 * (Railway refuses such files) and anything outside the subset.
 */
export function parseFlatToml(text) {
  const out = {};
  let table = out;
  const seenTables = new Set();
  text.split('\n').forEach((raw, i) => {
    const line = stripTomlComment(raw).trim();
    if (!line) return;
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (header) {
      if (seenTables.has(header[1])) throw new TomlError(i + 1, `duplicate table [${header[1]}]`);
      seenTables.add(header[1]);
      table = out[header[1]] = {};
      return;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) throw new TomlError(i + 1, `cannot parse "${raw.trim()}"`);
    const [, key, value] = kv;
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      throw new TomlError(i + 1, `duplicate key "${key}"`);
    }
    if (/^"(?:[^"\\]|\\.)*"$/.test(value)) table[key] = JSON.parse(value);
    else if (/^-?\d+$/.test(value)) table[key] = Number(value);
    else if (value === 'true' || value === 'false') table[key] = value === 'true';
    else throw new TomlError(i + 1, `unsupported value for "${key}": ${value}`);
  });
  return out;
}

// ── Validation ──────────────────────────────────────────────────────────────

function listFiles(dir, predicate) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out.sort();
}

function sameDefault(documented, code) {
  if (documented === undefined || code === null) return true; // not comparable
  if (documented === null) return code === '';
  return documented.replace(/_/g, '') === code;
}

/**
 * Run every check against a repository checkout.
 *
 * @param {string} repoRoot
 * @returns {{ findings: Array<{rule: string, file: string, line: number, message: string}>, summary: object }}
 */
export function checkIndexerOpsDocs(repoRoot) {
  const findings = [];
  const rel = (p) => relative(repoRoot, p).split('\\').join('/');
  const report = (rule, file, line, message) => findings.push({ rule, file, line, message });

  const indexerDir = join(repoRoot, 'indexer');
  const docsDir = join(repoRoot, 'docs', 'indexer');
  const configDocPath = join(docsDir, 'configuration.md');

  // Sources (non-test TypeScript under indexer/src)
  const sources = listFiles(
    join(indexerDir, 'src'),
    (f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f)
  ).map((f) => ({ file: rel(f), text: readFileSync(f, 'utf8') }));
  const envReads = extractEnvReads(sources);
  const metrics = extractMetricNames(readFileSync(join(indexerDir, 'src', 'metrics.ts'), 'utf8'));
  const apiSource = readFileSync(join(indexerDir, 'src', 'api.ts'), 'utf8');
  const routes = extractRoutes(apiSource);
  const healthStatuses = extractHealthStatuses(apiSource);
  const pkg = JSON.parse(readFileSync(join(indexerDir, 'package.json'), 'utf8'));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  // `pnpm --filter iln-indexer exec <bin>` resolves binaries from the indexer
  // package and then the workspace root, so both count.
  const binDirs = [
    join(indexerDir, 'node_modules', '.bin'),
    join(repoRoot, 'node_modules', '.bin'),
  ];
  const bins = new Set(binDirs.filter((d) => existsSync(d)).flatMap((d) => readdirSync(d)));
  const rootPkgPath = join(repoRoot, 'package.json');
  const rootPkg = existsSync(rootPkgPath) ? JSON.parse(readFileSync(rootPkgPath, 'utf8')) : {};
  const deps = new Set(
    [pkg, rootPkg].flatMap((p) => [
      ...Object.keys(p.dependencies ?? {}),
      ...Object.keys(p.devDependencies ?? {}),
    ])
  );
  // Binaries provided by declared dependencies (works without node_modules too).
  const KNOWN_BINS = {
    tsx: 'tsx',
    vitest: 'vitest',
    tsc: 'typescript',
    eslint: 'eslint',
    'ts-node': 'ts-node',
  };
  const hasBin = (name) => bins.has(name) || (KNOWN_BINS[name] && deps.has(KNOWN_BINS[name]));

  // 1. configuration.md ↔ code
  const configDoc = existsSync(configDocPath) ? readFileSync(configDocPath, 'utf8') : '';
  const documented = parseConfigTables(configDoc);
  const configRel = rel(configDocPath);
  for (const [name, read] of envReads) {
    const doc = documented.get(name);
    if (!doc) {
      report(
        RULES.ENV_UNDOCUMENTED,
        read.file,
        read.line,
        `${name} is read by the indexer but not documented in ${configRel}`
      );
    } else if (!sameDefault(doc.default, read.default)) {
      report(
        RULES.ENV_DEFAULT_MISMATCH,
        configRel,
        doc.line,
        `${name}: documented default ${JSON.stringify(
          doc.default
        )} but the code defaults to ${JSON.stringify(read.default)} (${read.file}:${read.line})`
      );
    }
  }
  for (const [name, doc] of documented) {
    if (!envReads.has(name)) {
      report(
        RULES.ENV_NOT_READ,
        configRel,
        doc.line,
        `${name} is documented but no indexer source reads it`
      );
    }
  }

  // 2. Every ops doc: routes, metrics, env assignments, commands
  const docs = listFiles(docsDir, (f) => f.endsWith('.md'));
  let routeRefs = 0;
  let metricRefs = 0;
  let commandRefs = 0;
  for (const docPath of docs) {
    const text = readFileSync(docPath, 'utf8');
    const file = rel(docPath);

    for (const ref of extractDocRoutes(text)) {
      routeRefs++;
      if (!findRoute(routes, ref.method, ref.path)) {
        report(
          RULES.ROUTE_UNKNOWN,
          file,
          ref.line,
          `${ref.method ?? 'request to'} ${ref.path} — no such indexer route`
        );
      }
    }

    for (const ref of extractDocMetrics(text)) {
      metricRefs++;
      const base = ref.name.replace(/_(bucket|sum|count)$/, '');
      const known =
        metrics.has(ref.name) || metrics.has(base) || /^iln_(process|nodejs)_/.test(ref.name);
      if (!known) {
        report(
          RULES.METRIC_UNKNOWN,
          file,
          ref.line,
          `${ref.name} is not a metric exported by indexer/src/metrics.ts`
        );
      }
    }

    for (const ref of extractDocEnvAssignments(text)) {
      if (
        !envReads.has(ref.name) &&
        !NON_CONFIG_ALLOWLIST.has(ref.name) &&
        ref.name !== 'NODE_ENV'
      ) {
        report(
          RULES.ENV_REFERENCE_UNKNOWN,
          file,
          ref.line,
          `${ref.name} is set here but the indexer never reads it`
        );
      }
    }

    for (const ref of extractDocHealthStatuses(text)) {
      if (healthStatuses.size > 0 && !healthStatuses.has(ref.status)) {
        report(
          RULES.HEALTH_CONTRACT,
          file,
          ref.line,
          `/health never returns status "${ref.status}" (it returns ${[...healthStatuses]
            .map((x) => `"${x}"`)
            .join(' or ')})`
        );
      }
    }

    for (const ref of extractDocCommands(text)) {
      commandRefs++;
      if (ref.kind === 'script' && !scripts.has(ref.name)) {
        report(
          RULES.COMMAND_UNKNOWN,
          file,
          ref.line,
          `"${ref.text}" — indexer/package.json has no "${ref.name}" script`
        );
      }
      if (ref.kind === 'bin' && !hasBin(ref.name)) {
        report(
          RULES.COMMAND_UNKNOWN,
          file,
          ref.line,
          `"${ref.text}" — "${ref.name}" is not installed in the indexer package or the workspace root`
        );
      }
    }
  }

  // 3. Railway deployment config
  const railwayPath = join(indexerDir, 'railway.toml');
  if (existsSync(railwayPath)) {
    const file = rel(railwayPath);
    try {
      const toml = parseFlatToml(readFileSync(railwayPath, 'utf8'));
      const deploy = toml.deploy ?? {};
      if (deploy.healthcheckPath && !findRoute(routes, 'GET', deploy.healthcheckPath)) {
        report(
          RULES.DEPLOY_CONFIG,
          file,
          0,
          `healthcheckPath ${deploy.healthcheckPath} is not an indexer route`
        );
      }
      for (const key of ['startCommand', 'buildCommand']) {
        const command = (key === 'buildCommand' ? toml.build?.[key] : deploy[key]) ?? '';
        for (const m of command.matchAll(/--filter\s+iln-indexer\s+([a-z][\w:-]*)/g)) {
          if (!scripts.has(m[1]))
            report(RULES.DEPLOY_CONFIG, file, 0, `${key} runs missing script "${m[1]}"`);
        }
      }
      for (const name of Object.keys(toml.variables ?? {})) {
        if (!envReads.has(name)) {
          report(
            RULES.DEPLOY_CONFIG,
            file,
            0,
            `[variables] sets ${name} but the indexer never reads it`
          );
        }
      }
    } catch (err) {
      if (!(err instanceof TomlError)) throw err;
      report(RULES.DEPLOY_CONFIG, file, err.line, `invalid TOML: ${err.message}`);
    }
  }

  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  return {
    findings,
    summary: {
      ok: findings.length === 0,
      total: findings.length,
      byRule,
      envVarsRead: envReads.size,
      envVarsDocumented: documented.size,
      docsScanned: docs.length,
      routeRefs,
      metricRefs,
      commandRefs,
    },
  };
}

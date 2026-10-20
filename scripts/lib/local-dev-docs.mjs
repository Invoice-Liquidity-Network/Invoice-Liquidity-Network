/**
 * scripts/lib/local-dev-docs.mjs
 *
 * Verifies docs/local-development.md against the repository it describes
 * (#1285). Every command, path, workspace, environment variable, default,
 * port and Docker Compose service the guide names is resolved against the
 * files that actually implement it, and the local-dev entry points themselves
 * (root scripts, docker-compose.yml, Makefile, dev-setup.sh) are checked for
 * the defects that made the documented workflow fail:
 *
 *   - root scripts that call `npm run <s> -w <pkg>` although npm workspaces
 *     are not declared (pnpm-workspace.yaml is authoritative), so npm exits
 *     with "No workspaces found";
 *   - `pnpm <script> -w <pkg>`, where `-w` means --workspace-root and the
 *     package name is silently passed to the root script;
 *   - Makefile `cd` into directories that do not exist;
 *   - WASM targets used by the Makefile/deployer but never installed by
 *     scripts/dev-setup.sh.
 *
 * Dependency-free on purpose: the CI job runs it with a bare `node`, before
 * (and independently of) `pnpm install`.
 *
 * See docs/runbooks/local-dev-docs.md for the recovery procedure.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export const DOC = 'docs/local-development.md';
/** Canonical-site copy that must carry the same tables and commands. */
export const CANONICAL = 'packages/docs/content/local-development.mdx';
const BLOB_BASE =
  'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/dev/docs/';

/** Doc heading → workspace directory whose source reads those variables. */
export const ENV_SECTIONS = {
  'Indexer Variables': 'indexer',
  'Notifications Variables': 'notifications',
  'Oracle Service Variables': 'oracle-service',
  'Docs Variables': 'docs',
};

/** Paths the guide names that are build outputs, not committed files. */
export const GENERATED_PATHS = ['cli/dist/', 'docs/sdk-api/', 'indexer/dist/'];

const PNPM_BUILTINS = new Set([
  'add',
  'audit',
  'dlx',
  'env',
  'exec',
  'i',
  'install',
  'licenses',
  'list',
  'ls',
  'outdated',
  'prune',
  'rebuild',
  'remove',
  'setup',
  'store',
  'update',
  'why',
]);

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'out',
  '__tests__',
  'tests',
  'test',
  '__fixtures__',
  '__mocks__',
]);

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

// ── small helpers ──────────────────────────────────────────────────────────

function read(repoRoot, rel) {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function tryRead(repoRoot, rel) {
  try {
    return read(repoRoot, rel);
  } catch {
    return null;
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function stripTicks(s) {
  return s
    .trim()
    .replace(/^`+|`+$/g, '')
    .trim();
}

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

/** Remove a trailing YAML/shell comment that is not inside quotes. */
function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}

/** Split a markdown table row into trimmed cells (no outer pipes). */
function cells(row) {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

// ── markdown model ─────────────────────────────────────────────────────────

/**
 * Parse markdown into sections (by heading), tables (with the heading they sit
 * under), fenced code lines and inline code spans — with line numbers.
 */
export function parseMarkdown(text) {
  const lines = text.split('\n');
  const tables = [];
  const code = []; // { text, line, fenced }
  const prose = []; // { text, line } (non-fenced lines)
  const headings = [];
  let heading = '';
  let fence = null;
  let table = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const n = i + 1;
    const fenceMatch = raw.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && raw.trim().startsWith(fence)) fence = null;
      else code.push({ text: raw, line: n, fenced: true });
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      table = null;
      continue;
    }
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      heading = h[2].trim();
      headings.push({ text: heading, level: h[1].length, line: n });
      table = null;
      continue;
    }
    prose.push({ text: raw, line: n });
    for (const m of raw.matchAll(/`([^`\n]+)`/g)) code.push({ text: m[1], line: n, fenced: false });
    if (/^\s*\|/.test(raw)) {
      if (!table) {
        table = { heading, header: cells(raw), rows: [], line: n };
        tables.push(table);
      } else if (/^\s*\|[\s:|-]+\|\s*$/.test(raw) && table.rows.length === 0) {
        // separator row
      } else {
        table.rows.push({ cells: cells(raw), line: n });
      }
    } else {
      table = null;
    }
  }
  return { tables, code, prose, headings };
}

// ── repository model ───────────────────────────────────────────────────────

/** Workspace globs from pnpm-workspace.yaml `packages:` (comments ignored). */
export function parseWorkspaceGlobs(text) {
  const globs = [];
  let inPackages = false;
  for (const raw of text.split('\n')) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (/^\S/.test(line)) inPackages = false;
    const m = inPackages && line.match(/^\s*-\s*(.+)$/);
    if (m) globs.push(unquote(m[1]));
  }
  return globs;
}

export function loadWorkspaces(repoRoot) {
  const globs = parseWorkspaceGlobs(read(repoRoot, 'pnpm-workspace.yaml'));
  const packages = new Map(); // name -> { dir, scripts }
  const dirs = [];
  for (const glob of globs) {
    const candidates = glob.endsWith('/*')
      ? (() => {
          const base = glob.slice(0, -2);
          const abs = join(repoRoot, base);
          return isDir(abs)
            ? readdirSync(abs)
                .filter((d) => isDir(join(abs, d)))
                .map((d) => `${base}/${d}`)
            : [];
        })()
      : [glob];
    for (const dir of candidates) {
      const pj = tryRead(repoRoot, `${dir}/package.json`);
      if (pj === null) continue;
      let json;
      try {
        json = JSON.parse(pj);
      } catch {
        json = {};
      }
      dirs.push(dir);
      if (json.name) packages.set(json.name, { dir, scripts: json.scripts ?? {} });
    }
  }
  return { globs, packages, dirs };
}

/**
 * Minimal docker-compose reader for the subset this repo uses: top-level
 * `services:` map, each service's `ports:` list and `command:` (plain,
 * quoted, flow-list or block scalar).
 */
export function parseCompose(text) {
  const lines = text.split('\n');
  const services = new Map();
  const headerComment = [];
  let i = 0;
  while (
    i < lines.length &&
    (/^\s*#/.test(lines[i]) || !lines[i].trim() || /^version:/.test(lines[i]))
  ) {
    if (/^\s*#/.test(lines[i])) headerComment.push(lines[i].replace(/^\s*#\s?/, ''));
    i++;
  }
  let inServices = false;
  let svc = null;
  let key = null;
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (/^\s*#/.test(raw) || !raw.trim()) continue;
    const indent = raw.match(/^ */)[0].length;
    const body = stripComment(raw.trim());
    if (indent === 0) {
      inServices = body === 'services:';
      svc = null;
      continue;
    }
    if (!inServices) continue;
    if (indent === 2) {
      const m = body.match(/^([\w.-]+):\s*$/);
      svc = m ? { name: m[1], ports: [], command: null, line: n + 1 } : null;
      if (svc) services.set(svc.name, svc);
      key = null;
      continue;
    }
    if (!svc) continue;
    if (indent === 4) {
      const m = body.match(/^([\w-]+):\s*(.*)$/);
      if (!m) continue;
      key = m[1];
      const value = m[2];
      if (key === 'command') {
        if (/^[>|][+-]?$/.test(value)) {
          const folded = value.startsWith('>');
          const parts = [];
          let j = n + 1;
          while (
            j < lines.length &&
            (lines[j].trim() === '' || lines[j].match(/^ */)[0].length > 4)
          ) {
            parts.push(lines[j].trim());
            j++;
          }
          svc.command = parts.join(folded ? ' ' : '\n').trim();
        } else if (value.startsWith('[')) {
          svc.command = value
            .slice(1, value.lastIndexOf(']'))
            .split(/,(?=(?:[^'"]*['"][^'"]*['"])*[^'"]*$)/)
            .map(unquote)
            .join(' ');
        } else {
          svc.command = unquote(value);
        }
      }
      continue;
    }
    if (key === 'ports' && indent >= 6) {
      const m = body.match(/^-\s*(.+)$/);
      if (m) {
        const spec = unquote(m[1]);
        const parts = spec.split(':');
        // "host:container" or "ip:host:container"
        const host = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        svc.ports.push(Number(host));
      }
    }
  }
  return { services, headerComment: headerComment.join('\n') };
}

/** Targets defined in a Makefile, and every `cd <dir>` its recipes use. */
export function parseMakefile(text) {
  const targets = new Set();
  const cds = [];
  text.split('\n').forEach((raw, i) => {
    const t = raw.match(/^([A-Za-z0-9_.-]+)\s*:(?!=)/);
    if (t && t[1] !== '.PHONY') targets.add(t[1]);
    if (/^\t/.test(raw)) {
      for (const m of raw.matchAll(/(?:^|[\s;&@])cd\s+([^\s;&|)]+)/g))
        cds.push({ dir: m[1], line: i + 1 });
    }
  });
  return { targets, cds };
}

export function parseGitmodulePaths(text) {
  return [...(text ?? '').matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((m) => m[1]);
}

/** Keys an .env.example declares, including commented-out `# KEY=` lines. */
export function parseEnvExample(text) {
  const keys = [];
  text.split('\n').forEach((raw, i) => {
    const m = raw.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/);
    if (m) keys.push({ key: m[1], line: i + 1 });
  });
  return keys;
}

function walkSources(root, rel, out) {
  const abs = join(root, rel);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walkSources(root, childRel, out);
    } else if (
      SOURCE_EXT.test(e.name) &&
      !/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name) &&
      !e.name.endsWith('.d.ts')
    ) {
      out.push(childRel);
    }
  }
  return out;
}

const DEFAULT_LITERAL = String.raw`(?:'([^']*)'|"([^"]*)"|\x60([^\x60]*)\x60|(-?\d[\d_]*(?:\.\d+)?)|([A-Z][A-Z0-9_]+)\b)`;

/**
 * Environment variables a workspace's (non-test) source reads, with every
 * literal default it falls back to.
 */
export function collectEnvReads(repoRoot, dir) {
  const reads = new Map(); // name -> Set(defaults)
  const add = (name, def) => {
    if (!reads.has(name)) reads.set(name, new Set());
    if (def !== undefined && def !== null) reads.get(name).add(String(def));
  };
  for (const file of walkSources(join(repoRoot, dir), '', [])) {
    const src = readFileSync(join(repoRoot, dir, file), 'utf8');
    const constants = new Map();
    for (const m of src.matchAll(
      new RegExp(
        `\\bconst\\s+([A-Z][A-Z0-9_]+)\\s*(?::\\s*\\w+\\s*)?=\\s*${DEFAULT_LITERAL}\\s*;`,
        'g'
      )
    )) {
      constants.set(m[1], m[2] ?? m[3] ?? m[4] ?? m[5]);
    }
    // groups: [single, double, template, number, CONSTANT] → literal string or null
    const literal = (g) => {
      const v = g[4] !== undefined ? constants.get(g[4]) : g[0] ?? g[1] ?? g[2] ?? g[3];
      return v === undefined ? null : /^-?\d[\d_]*(\.\d+)?$/.test(v) ? v.replace(/_/g, '') : v;
    };
    const access = String.raw`(?:process\.env|import\.meta\.env)(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])`;
    for (const m of src.matchAll(new RegExp(access, 'g'))) add(m[1] ?? m[2]);
    for (const m of src.matchAll(
      new RegExp(`${access}\\s*(?:\\?\\?|\\|\\|)\\s*${DEFAULT_LITERAL}`, 'g')
    )) {
      add(m[1] ?? m[2], literal(m.slice(3, 8)));
    }
    // wrapper(process.env.X, 1_000) — e.g. positiveNumber(), parsePositiveInt()
    for (const m of src.matchAll(
      new RegExp(`\\w+\\(\\s*${access}\\s*,\\s*${DEFAULT_LITERAL}\\s*[,)]`, 'g')
    )) {
      add(m[1] ?? m[2], literal(m.slice(3, 8)));
    }
    for (const m of src.matchAll(new RegExp(`${access}\\s*!==\\s*['"]false['"]`, 'g')))
      add(m[1] ?? m[2], 'true');
    for (const m of src.matchAll(new RegExp(`${access}\\s*===\\s*['"]true['"]`, 'g')))
      add(m[1] ?? m[2], 'false');
    // Helper readers such as parseIntEnv('PORT', 4001) / requiredEnv('X').
    const helper = String.raw`\b\w*[Ee]nv\w*\(\s*['"]([A-Z][A-Z0-9_]*)['"]`;
    for (const m of src.matchAll(new RegExp(helper, 'g'))) add(m[1]);
    for (const m of src.matchAll(new RegExp(`${helper}\\s*,\\s*${DEFAULT_LITERAL}\\s*\\)`, 'g'))) {
      add(m[1], literal(m.slice(2, 7)));
    }
  }
  return reads;
}

// ── command extraction ─────────────────────────────────────────────────────

/** Split a shell-ish string into the individual `pnpm …` invocations. */
export function pnpmInvocations(text) {
  const out = [];
  for (const segment of text.split(/&&|\|\||;|\||\n/)) {
    const cleaned = segment.replace(/\s#.*$/, '').trim();
    const m = cleaned.match(/(?:^|\s|corepack\s+)pnpm\s+(.+)$/);
    if (!m) continue;
    out.push(
      m[1]
        .trim()
        .split(/\s+/)
        .map((t) => t.replace(/^['"]+|['"]+$/g, ''))
        .filter(Boolean)
    );
  }
  return out;
}

/**
 * Classify one pnpm argv into { kind: 'filter', pkg, script } |
 * { kind: 'root', script } | { kind: 'workspace-root-flag', script, arg } | null.
 */
export function classifyPnpm(argv) {
  const args = [...argv];
  let filter = null;
  let workspaceRootFlagAt = -1;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--filter' || a === '-F') {
      filter = args[++i] ?? null;
    } else if (a.startsWith('--filter=')) {
      filter = a.slice('--filter='.length);
    } else if (a === '-w' || a === '--workspace-root') {
      workspaceRootFlagAt = positional.length;
    } else if (a.startsWith('-')) {
      // other flags (--frozen-lockfile, -r, --version …) carry no script
      if (positional.length === 0 && !filter) return null;
    } else {
      positional.push(a);
    }
  }
  if (positional[0] === 'run') positional.shift();
  const script = positional[0];
  if (!script || PNPM_BUILTINS.has(script)) return null;
  if (workspaceRootFlagAt >= 0 && positional.length > 1) {
    return { kind: 'workspace-root-flag', script, arg: positional[1] };
  }
  if (filter) return { kind: 'filter', pkg: filter, script };
  return { kind: 'root', script };
}

// ── the audit ──────────────────────────────────────────────────────────────

/**
 * @param {string} repoRoot
 * @returns {{ findings: object[], summary: object }}
 */
export function checkLocalDevDocs(repoRoot) {
  const findings = [];
  const add = (rule, file, line, message) => findings.push({ rule, file, line, message });
  const summary = {
    commands: 0,
    paths: 0,
    envVars: 0,
    defaults: 0,
    services: 0,
    workspaces: 0,
  };

  const doc = tryRead(repoRoot, DOC);
  if (doc === null) {
    add('doc-unreadable', DOC, 0, 'guide is missing or unreadable');
    return finish(findings, summary);
  }
  let rootPkg;
  try {
    rootPkg = JSON.parse(read(repoRoot, 'package.json'));
  } catch (err) {
    add('repo-unreadable', 'package.json', 0, `cannot parse root package.json: ${err.message}`);
    return finish(findings, summary);
  }
  let ws;
  try {
    ws = loadWorkspaces(repoRoot);
  } catch (err) {
    add('repo-unreadable', 'pnpm-workspace.yaml', 0, `cannot read workspaces: ${err.message}`);
    return finish(findings, summary);
  }
  const rootScripts = rootPkg.scripts ?? {};
  const md = parseMarkdown(doc);

  // 1. Root scripts must not rely on npm workspaces (pnpm-workspace.yaml is authoritative).
  const pkgText = read(repoRoot, 'package.json');
  for (const [name, cmd] of Object.entries(rootScripts)) {
    const line = lineOf(pkgText, pkgText.indexOf(`"${name}"`));
    if (
      !rootPkg.workspaces &&
      /\bnpm\s+(?:run(?:-script)?\s+\S+.*?)?\s(?:-w|--workspace)(?:=|\s)/.test(cmd)
    ) {
      add(
        'root-script-npm-workspace',
        'package.json',
        line,
        `script "${name}" uses npm --workspace, but package.json declares no "workspaces" (pnpm-workspace.yaml is authoritative), so npm fails with "No workspaces found" — use pnpm --filter`
      );
    }
  }

  // 2. Every pnpm invocation — in the guide, root scripts and compose commands — must resolve.
  const compose = parseCompose(tryRead(repoRoot, 'docker-compose.yml') ?? '');
  const sources = [
    ...md.code.map((c) => ({ text: c.text, file: DOC, line: c.line })),
    ...Object.entries(rootScripts).map(([name, cmd]) => ({
      text: cmd,
      file: 'package.json',
      line: lineOf(pkgText, pkgText.indexOf(`"${name}"`)),
    })),
    ...[...compose.services.values()]
      .filter((s) => s.command)
      .map((s) => ({ text: s.command, file: 'docker-compose.yml', line: s.line })),
  ];
  const seen = new Set();
  for (const src of sources) {
    for (const argv of pnpmInvocations(src.text)) {
      const inv = classifyPnpm(argv);
      if (!inv) continue;
      const key = `${src.file}:${src.line}:${argv.join(' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      summary.commands++;
      if (inv.kind === 'workspace-root-flag') {
        add(
          'pnpm-workspace-root-flag',
          src.file,
          src.line,
          `\`pnpm ${argv.join(' ')}\`: -w means --workspace-root, so "${
            inv.arg
          }" is passed to the root "${inv.script}" script — use \`pnpm --filter ${inv.arg} ${
            inv.script
          }\``
        );
      } else if (inv.kind === 'filter') {
        const pkg = inv.pkg.replace(/\.\.\.$/, '').replace(/^\.\.\./, '');
        if (/[<>{}*]/.test(pkg) || /[<>{}]/.test(inv.script)) continue;
        const target = ws.packages.get(pkg);
        if (!target) {
          add(
            'filter-unknown-package',
            src.file,
            src.line,
            `\`pnpm --filter ${inv.pkg}\`: no workspace package is named "${pkg}"`
          );
        } else if (!(inv.script in target.scripts)) {
          add(
            'filter-unknown-script',
            src.file,
            src.line,
            `\`pnpm --filter ${pkg} ${inv.script}\`: ${target.dir}/package.json has no "${inv.script}" script`
          );
        }
      } else if (src.file === DOC && !(inv.script in rootScripts)) {
        if (/[<>{}*]/.test(inv.script)) continue;
        add(
          'root-script-missing',
          src.file,
          src.line,
          `\`pnpm ${inv.script}\`: root package.json has no "${inv.script}" script`
        );
      }
    }
  }

  // 3. make targets the guide names must exist; Makefile `cd` targets must exist.
  const makefile = tryRead(repoRoot, 'Makefile');
  const gitmodules = parseGitmodulePaths(tryRead(repoRoot, '.gitmodules'));
  if (makefile !== null) {
    const mk = parseMakefile(makefile);
    for (const c of md.code) {
      for (const m of c.text.matchAll(/(?:^|[\s(])make\s+([A-Za-z0-9_.-]+)/g)) {
        summary.commands++;
        if (!mk.targets.has(m[1]))
          add(
            'make-target-missing',
            DOC,
            c.line,
            `\`make ${m[1]}\`: Makefile has no "${m[1]}" target`
          );
      }
    }
    for (const { dir, line } of mk.cds) {
      if (dir.startsWith('$') || dir === '..' || dir === '-') continue;
      if (!isDir(join(repoRoot, dir)) && !gitmodules.includes(dir)) {
        add(
          'make-cd-missing',
          'Makefile',
          line,
          `recipe runs \`cd ${dir}\`, but no "${dir}" directory or submodule exists`
        );
      }
    }
  }

  // 4. WASM targets used to build/deploy must be installed by scripts/dev-setup.sh.
  const devSetup = tryRead(repoRoot, 'scripts/dev-setup.sh');
  if (devSetup !== null) {
    const installed = new Set();
    for (const line of devSetup.split('\n')) {
      if (/rustup\s+target\s+add|^\s*for\s+\w+\s+in\s/.test(line)) {
        for (const m of line.matchAll(/\bwasm32[\w-]*/g)) installed.add(m[0]);
      }
    }
    // The guide's Scripts Reference row for dev-setup.sh must name exactly the
    // targets it installs.
    const row = md.tables
      .flatMap((t) => t.rows)
      .find((r) => stripTicks(r.cells[0] ?? '') === 'scripts/dev-setup.sh');
    if (row) {
      const named = new Set(row.cells.join(' ').match(/\bwasm32[\w-]*/g) ?? []);
      const missing = [...installed].filter((t) => !named.has(t));
      const extra = [...named].filter((t) => !installed.has(t));
      if (missing.length || extra.length) {
        add(
          'dev-setup-target-drift',
          DOC,
          row.line,
          `guide says dev-setup.sh installs [${[...named].join(', ')}], it installs [${[
            ...installed,
          ].join(', ')}]`
        );
      }
    }
    for (const file of ['Makefile', 'contract-deployer/deploy.sh']) {
      const text = tryRead(repoRoot, file);
      if (text === null) continue;
      text.split('\n').forEach((raw, i) => {
        for (const m of raw.matchAll(/target\/(wasm32[\w-]*)\//g)) {
          if (!installed.has(m[1])) {
            add(
              'wasm-target-not-installed',
              file,
              i + 1,
              `uses target/${m[1]}/ but scripts/dev-setup.sh never runs \`rustup target add ${m[1]}\``
            );
          }
        }
      });
    }
  }

  // 5. Paths and relative links in the guide must exist.
  const checkedPaths = new Set();
  const pathRe =
    /^(?:\.\/)?((?:scripts|docs|packages|examples|sdk|cli|indexer|notifications|oracle-service|contract-deployer|account-seeder|tests|\.github)\/[\w@./-]*|docker-compose\.yml|Makefile|pnpm-workspace\.yaml|pnpm-lock\.yaml|\.gitmodules|turbo\.json)$/;
  for (const c of md.code) {
    if (c.fenced) continue;
    for (const token of c.text.split(/\s+/)) {
      const m = token.match(pathRe);
      if (!m) continue;
      const p = m[1];
      if (
        GENERATED_PATHS.some((g) => p.startsWith(g)) ||
        p.includes('*') ||
        p.startsWith('.docker-output')
      )
        continue;
      const k = `${p}@${c.line}`;
      if (checkedPaths.has(k)) continue;
      checkedPaths.add(k);
      summary.paths++;
      if (!existsSync(join(repoRoot, p)))
        add('path-missing', DOC, c.line, `\`${p}\` does not exist`);
    }
  }
  for (const p of md.prose) {
    for (const m of p.text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      summary.paths++;
      const resolved = posix.normalize(posix.join(posix.dirname(DOC), target));
      if (!existsSync(join(repoRoot, resolved)))
        add('link-missing', DOC, p.line, `link target ${target} (${resolved}) does not exist`);
    }
  }

  // 6. Prerequisite versions must match package.json engines.
  for (const t of md.tables.filter((t) => /^prerequisites$/i.test(t.heading))) {
    for (const row of t.rows) {
      const tool = row.cells[0]?.toLowerCase();
      const version = row.cells[1]?.match(/`([^`]+)`/)?.[1];
      const engine =
        tool === 'node.js'
          ? rootPkg.engines?.node
          : tool === 'pnpm'
          ? rootPkg.engines?.pnpm
          : undefined;
      if (version && engine !== undefined && version !== engine) {
        add(
          'prerequisite-drift',
          DOC,
          row.line,
          `${row.cells[0]} documented as ${version}, root engines say ${engine}`
        );
      }
    }
  }

  // 7. Workspaces: every pnpm-workspace.yaml entry and examples/* app is named,
  //    and every catalog row's package name matches its package.json.
  for (const glob of ws.globs) {
    summary.workspaces++;
    const bare = glob.replace(/\/\*$/, '');
    const mentioned = md.code.some(
      (c) => !c.fenced && [glob, `${glob}/`, bare, `${bare}/`].includes(c.text.trim())
    );
    if (!mentioned)
      add(
        'workspace-undocumented',
        DOC,
        0,
        `pnpm-workspace.yaml entry "${glob}" is not named in the guide`
      );
  }
  for (const dir of ws.dirs.filter((d) => d.startsWith('examples/'))) {
    const name = dir.slice('examples/'.length);
    if (!md.code.some((c) => c.text.trim() === name || c.text.trim() === `${dir}/`)) {
      add('example-undocumented', DOC, 0, `${dir} is not listed in the examples catalog`);
    }
  }
  for (const t of md.tables) {
    const pathCol = t.header.findIndex((h) => /^path$/i.test(h));
    const pkgCol = t.header.findIndex((h) => /^package$/i.test(h));
    if (pathCol < 0 || pkgCol < 0) continue;
    for (const row of t.rows) {
      const dir = stripTicks(row.cells[pathCol] ?? '').replace(/\/$/, '');
      const documented = row.cells[pkgCol]?.match(/^`([^`]+)`$/)?.[1];
      if (!dir || !documented) continue;
      const pj = tryRead(repoRoot, `${dir}/package.json`);
      if (pj === null) {
        add('package-name-drift', DOC, row.line, `${dir}/package.json does not exist`);
        continue;
      }
      let actual;
      try {
        actual = JSON.parse(pj).name;
      } catch {
        actual = undefined;
      }
      if (actual !== documented)
        add(
          'package-name-drift',
          DOC,
          row.line,
          `${dir} is "${actual}", guide says "${documented}"`
        );
    }
  }

  // 8. Environment: copy commands, "no .env.example" claims, tables vs code and examples.
  for (const c of md.code) {
    for (const m of c.text.matchAll(/(?:^|\s)cp\s+(\S+)\s+(\S+)/g)) {
      summary.paths++;
      if (!existsSync(join(repoRoot, m[1])))
        add('env-example-missing', DOC, c.line, `\`cp ${m[1]} ${m[2]}\`: ${m[1]} does not exist`);
    }
  }
  for (const p of md.prose) {
    for (const m of p.text.matchAll(/`([\w-]+)\/`\s+has no\s+`\.env\.example`/g)) {
      if (existsSync(join(repoRoot, m[1], '.env.example'))) {
        add(
          'env-example-claim',
          DOC,
          p.line,
          `guide says ${m[1]}/ has no .env.example, but ${m[1]}/.env.example exists`
        );
      }
    }
  }
  const envTables = new Map(); // dir -> Map(var -> {line, default})
  for (const t of md.tables) {
    const dir = ENV_SECTIONS[t.heading];
    if (!dir) continue;
    const varCol = t.header.findIndex((h) => /^variable$/i.test(h));
    const defCol = t.header.findIndex((h) => /^default$/i.test(h));
    if (varCol < 0) continue;
    if (!envTables.has(dir)) envTables.set(dir, new Map());
    for (const row of t.rows) {
      const names = [...(row.cells[varCol] ?? '').matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(
        (m) => m[1]
      );
      const defaults = defCol >= 0 ? (row.cells[defCol] ?? '').split(/\s+\/\s+/) : [];
      names.forEach((name, i) => {
        envTables.get(dir).set(name, {
          line: row.line,
          default:
            defaults.length === names.length
              ? defaults[i]
              : names.length === 1
              ? defaults[0]
              : undefined,
        });
      });
    }
  }
  for (const [heading, dir] of Object.entries(ENV_SECTIONS)) {
    const documented = envTables.get(dir);
    if (!documented) {
      add('env-section-missing', DOC, 0, `no "${heading}" table`);
      continue;
    }
    const reads = collectEnvReads(repoRoot, dir);
    for (const [name, info] of documented) {
      summary.envVars++;
      if (!reads.has(name)) {
        add(
          'env-var-unread',
          DOC,
          info.line,
          `${name} is documented for ${dir}/, but no ${dir}/ source reads it`
        );
        continue;
      }
      const literal = info.default?.match(/^`([^`]*)`$/)?.[1];
      const codeDefaults = reads.get(name);
      if (literal !== undefined && codeDefaults.size > 0) {
        summary.defaults++;
        const norm = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? String(Number(v)) : v);
        if (![...codeDefaults].map(norm).includes(norm(literal))) {
          add(
            'env-default-drift',
            DOC,
            info.line,
            `${name} default documented as ${literal}, ${dir}/ falls back to ${[
              ...codeDefaults,
            ].join(' / ')}`
          );
        }
      }
    }
    const example = tryRead(repoRoot, `${dir}/.env.example`);
    if (example !== null) {
      for (const { key, line } of parseEnvExample(example)) {
        if (!documented.has(key)) {
          add(
            'env-example-undocumented',
            `${dir}/.env.example`,
            line,
            `${key} is in ${dir}/.env.example but not in the guide's "${heading}" table`
          );
        }
        if (!reads.has(key)) {
          add(
            'env-example-unread',
            `${dir}/.env.example`,
            line,
            `${key} is in ${dir}/.env.example but no ${dir}/ source reads it`
          );
        }
      }
    }
  }

  // 9. Docker Compose: service table, counts, commands, ports and outputs.
  if (compose.services.size === 0) {
    add(
      'compose-unreadable',
      'docker-compose.yml',
      0,
      'no services parsed from docker-compose.yml'
    );
  } else {
    const actual = [...compose.services.keys()];
    summary.services = actual.length;
    const hostPorts = new Set([...compose.services.values()].flatMap((s) => s.ports));
    const table = md.tables.find(
      (t) => t.header[0]?.toLowerCase() === 'service' && t.header.some((h) => /port/i.test(h))
    );
    if (!table) {
      add(
        'compose-table-missing',
        DOC,
        0,
        'no Docker Compose service table (Service | … | Port(s) | …)'
      );
    } else {
      const portCol = table.header.findIndex((h) => /port/i.test(h));
      const purposeCol = table.header.findIndex((h) => /purpose/i.test(h));
      const documented = new Set();
      for (const row of table.rows) {
        const name = stripTicks(row.cells[0] ?? '');
        documented.add(name);
        const svc = compose.services.get(name);
        if (!svc) {
          add(
            'compose-service-drift',
            DOC,
            row.line,
            `service "${name}" is not defined in docker-compose.yml`
          );
          continue;
        }
        const ports = [...(row.cells[portCol] ?? '').matchAll(/`(\d+)`/g)].map((m) => Number(m[1]));
        if (ports.sort().join(',') !== [...svc.ports].sort().join(',')) {
          add(
            'compose-port-drift',
            DOC,
            row.line,
            `${name} ports documented as [${ports}], docker-compose.yml publishes [${svc.ports}]`
          );
        }
        const runs = purposeCol >= 0 && row.cells[purposeCol]?.match(/Runs `([^`]+)`/);
        if (runs && !(svc.command ?? '').includes(runs[1])) {
          add(
            'compose-command-drift',
            DOC,
            row.line,
            `${name} documented as running \`${runs[1]}\`, docker-compose.yml runs \`${svc.command}\``
          );
        }
      }
      for (const name of actual) {
        if (!documented.has(name))
          add(
            'compose-service-drift',
            DOC,
            table.line,
            `docker-compose.yml service "${name}" is missing from the table`
          );
      }
    }
    const countRe = /\b(?:defines|all|the)\s+(\w+)\s+services\b/gi;
    for (const p of md.prose) {
      if (!/docker-compose|compose|stack|healthy/i.test(p.text)) continue;
      for (const m of p.text.matchAll(countRe)) {
        const n = NUMBER_WORDS[m[1].toLowerCase()] ?? (/^\d+$/.test(m[1]) ? Number(m[1]) : null);
        if (n !== null && n !== actual.length) {
          add(
            'compose-count-drift',
            DOC,
            p.line,
            `says "${m[0]}", docker-compose.yml defines ${actual.length}`
          );
        }
      }
    }
    for (const m of compose.headerComment.matchAll(
      /manages\s+(\w+)\s+services|starts\s+all\s+(\w+)\b/gi
    )) {
      const word = (m[1] ?? m[2]).toLowerCase();
      const n = NUMBER_WORDS[word];
      if (n !== undefined && n !== actual.length) {
        add(
          'compose-count-drift',
          'docker-compose.yml',
          0,
          `header comment says "${m[0]}", file defines ${actual.length} services`
        );
      }
    }
    for (const p of md.prose) {
      if (!/\bports?\b/i.test(p.text)) continue;
      const nums = [...p.text.matchAll(/`(\d{4,5})`/g)].map((m) => Number(m[1]));
      if (nums.length < 3) continue;
      const missing = [...hostPorts].filter((x) => !nums.includes(x));
      const extra = nums.filter((x) => !hostPorts.has(x));
      if (missing.length || extra.length) {
        add(
          'compose-port-drift',
          DOC,
          p.line,
          `port list ${nums.join(
            ', '
          )} differs from docker-compose.yml host ports (missing [${missing}], extra [${extra}])`
        );
      }
    }
    const writers = ['account-seeder/seed.sh', 'contract-deployer/deploy.sh']
      .map((f) => tryRead(repoRoot, f) ?? '')
      .join('\n');
    for (const c of md.code) {
      const m = c.text.match(/^\.docker-output\/([\w.-]+)$/);
      if (m && !writers.includes(`.docker-output/${m[1]}`)) {
        add(
          'docker-output-unwritten',
          DOC,
          c.line,
          `.docker-output/${m[1]} is documented but neither the deployer nor the seeder writes it`
        );
      }
    }
  }

  // 10. The canonical-site copy must carry the same tables and commands.
  const canonical = tryRead(repoRoot, CANONICAL);
  if (canonical === null) {
    add('canonical-port-missing', CANONICAL, 0, `canonical copy of ${DOC} is missing`);
  } else {
    const normalize = (text) =>
      text.replace(/\]\((?![a-z]+:|#)([^)\s]+)\)/gi, (_m, t) => `](${BLOB_BASE}${t})`);
    const shape = (text) => {
      const m = parseMarkdown(normalize(text));
      return {
        rows: m.tables.flatMap((t) =>
          [t.header, ...t.rows.map((r) => r.cells)].map((c) => c.join(' | '))
        ),
        code: m.code.filter((c) => c.fenced).map((c) => c.text.trim()),
      };
    };
    const a = shape(doc);
    const b = shape(canonical);
    const missingRows = a.rows.filter((r) => !b.rows.includes(r));
    const extraRows = b.rows.filter((r) => !a.rows.includes(r));
    const missingCode = a.code.filter((c) => !b.code.includes(c));
    for (const r of missingRows.slice(0, 5))
      add(
        'canonical-port-drift',
        CANONICAL,
        0,
        `missing table row from ${DOC}: ${r.slice(0, 120)}`
      );
    for (const r of extraRows.slice(0, 5))
      add('canonical-port-drift', CANONICAL, 0, `table row not in ${DOC}: ${r.slice(0, 120)}`);
    for (const c of missingCode.slice(0, 5))
      add('canonical-port-drift', CANONICAL, 0, `missing command from ${DOC}: ${c.slice(0, 120)}`);
  }

  return finish(findings, summary);
}

function finish(findings, summary) {
  const unique = [];
  const keys = new Set();
  for (const f of findings) {
    const k = `${f.rule}|${f.file}|${f.line}|${f.message}`;
    if (!keys.has(k)) {
      keys.add(k);
      unique.push(f);
    }
  }
  return {
    findings: unique,
    summary: { ...summary, total: unique.length, ok: unique.length === 0 },
  };
}

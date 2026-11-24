/**
 * sdk-surface.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Small dependency-free helpers shared by the SDK surface guards:
 *   - scripts/check-example-package-names.mjs   (#1220)
 *   - scripts/check-react-sdk-imports.mjs       (#1221)
 *   - scripts/check-sdk-deprecations.mjs        (#1222)
 *
 * Plain Node, no pnpm install required.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const ALLOW_PRAGMA = 'sdk-name-check: allow-legacy';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'target',
  '__fixtures__',
  '.pnpm-store',
]);

/** Workspace roots that may hold a package.json (mirrors pnpm-workspace.yaml). */
const WORKSPACE_ROOTS = ['sdk', 'cli', 'indexer', 'notifications', 'oracle-service', 'docs'];
const WORKSPACE_GLOB_PARENTS = ['packages', 'examples'];
const WORKSPACE_EXTRA = ['tests/sdk-integration'];

export function toPosix(p) {
  return p.split(sep).join('/');
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/** Recursively lists files under `dir` whose extension is in `exts`. */
export function walkFiles(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) visit(full);
      else if (exts.some((ext) => entry.endsWith(ext))) out.push(full);
    }
  };
  visit(dir);
  return out.sort();
}

/**
 * Maps every workspace package name to its directory (repo-relative, posix).
 * @returns {Map<string, string>}
 */
export function listWorkspacePackages(root) {
  const dirs = [...WORKSPACE_ROOTS, ...WORKSPACE_EXTRA];
  for (const parent of WORKSPACE_GLOB_PARENTS) {
    const parentDir = join(root, parent);
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir)) {
      if (statSync(join(parentDir, entry)).isDirectory()) dirs.push(`${parent}/${entry}`);
    }
  }
  const names = new Map();
  for (const dir of dirs) {
    const manifest = join(root, dir, 'package.json');
    if (!existsSync(manifest)) continue;
    try {
      const { name } = readJson(manifest);
      if (typeof name === 'string') names.set(name, dir);
    } catch {
      // A malformed manifest is reported by the guards that read it directly.
    }
  }
  return names;
}

/** All module specifiers imported/required in JS/TS source text. */
export function extractSpecifiers(text) {
  const found = [];
  const patterns = [
    /\bfrom\s+(['"])([^'"\n]+)\1/g,
    /\bimport\s+(['"])([^'"\n]+)\1/g,
    /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ];
  const lines = text.split('\n');
  lines.forEach((lineText, idx) => {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lineText)) !== null) {
        found.push({ spec: m[2], line: idx + 1, column: m.index + 1, text: lineText });
      }
    }
  });
  return found;
}

/** Every `@iln/<name>` token in free text (code, markdown, JSON). */
export function extractIlnTokens(text) {
  const found = [];
  text.split('\n').forEach((lineText, idx) => {
    const re = /@iln\/[a-z0-9][a-z0-9-]*/g;
    let m;
    while ((m = re.exec(lineText)) !== null) {
      found.push({ name: m[0], line: idx + 1, column: m.index + 1, text: lineText });
    }
  });
  return found;
}

/** Package name of a bare specifier: `@iln/sdk/legacy` → `@iln/sdk`. */
export function packageNameOf(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function declaredDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

export function sortFindings(findings) {
  return findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0) ||
      a.rule.localeCompare(b.rule)
  );
}

export function summarize(findings) {
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  return {
    ok: findings.length === 0,
    total: findings.length,
    filesWithFindings: new Set(findings.map((f) => f.file)).size,
    byRule,
  };
}

export function relPosix(root, file) {
  return toPosix(relative(root, file));
}

#!/usr/bin/env node
/**
 * scripts/check-meta-nav.mjs
 *
 * Diffs every Nextra _meta.json in docs/ against the actual file tree and
 * reports two categories of problems:
 *
 *   ORPHANED  — a key in _meta.json has no matching .md/.mdx/.tsx file or
 *               subdirectory in the same directory.
 *
 *   UNDISCOVERABLE — a .md/.mdx/.tsx file (or navigable subdirectory) exists
 *               but has no entry in the sibling _meta.json, making it
 *               reachable only by direct URL.
 *
 * Separator keys (keys starting with "-- ") are intentionally skipped because
 * Nextra uses them as visual dividers, not page references.
 *
 * Files explicitly excluded from nav enforcement (non-content files that
 * should never appear in the sidebar) are listed in EXCLUDED_FILES below.
 *
 * Usage:
 *   node scripts/check-meta-nav.mjs [--docs-dir <path>]
 *
 * Exit codes:
 *   0 — no problems found
 *   1 — orphaned or undiscoverable entries found (CI will fail)
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { resolve, join, relative, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ─── Configuration ────────────────────────────────────────────────────────────

/** Nav page extensions Nextra recognises. */
const PAGE_EXTENSIONS = new Set(['.md', '.mdx', '.tsx', '.jsx', '.js']);

/**
 * Files (by basename, no extension) that must never appear in _meta.json.
 * These are internal docs, scratch files, or framework files that Nextra
 * renders as nav pages but are not meant to be discoverable.
 */
const EXCLUDED_FILES = new Set([
  'README',
  'DOCS_SETUP',
  'CHANGELOG_IMPLEMENTATION',
  'pr_description',
  'pr-16-submission-form',
  '_app', // Next.js custom App
]);

/** Directories to ignore when walking the docs tree. */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'components', // React component helpers, not Nextra pages
  'scripts',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if a key is a Nextra separator (visual divider, not a page).
 * Convention used in this repo: separator keys start with "-- ".
 * Also handles the Nextra v2 { type: "separator" } object format.
 */
function isSeparatorKey(key) {
  return key.startsWith('-- ');
}

function isSeparatorValue(value) {
  return value !== null && typeof value === 'object' && value.type === 'separator';
}

/**
 * Reads and parses a _meta.json file. Returns {} if the file does not exist.
 */
export function parseMetaCode(code, filePath) {
  const meta = {};
  const stripped = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  const exportMatch = stripped.match(/export\s+default\s*\{([\s\S]*)\}/);
  if (!exportMatch) {
    return meta;
  }
  const body = exportMatch[1];
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let currentToken = '';

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (inString) {
      if (char === stringChar && body[i - 1] !== '\\') {
        inString = false;
      } else {
        currentToken += char;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      inString = true;
      stringChar = char;
      currentToken = '';
      continue;
    }

    if (char === '{' || char === '[' || char === '(') {
      depth++;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth--;
      continue;
    }

    if (depth === 0) {
      if (char === ':') {
        const key = currentToken.trim();
        if (key) {
          meta[key] = true;
        }
        currentToken = '';
      } else if (char === ',') {
        currentToken = '';
      } else if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') {
        currentToken += char;
      }
    }
  }

  return meta;
}

function readMeta(dir) {
  const jsonPath = join(dir, '_meta.json');
  if (existsSync(jsonPath)) {
    try {
      return JSON.parse(readFileSync(jsonPath, 'utf-8'));
    } catch (err) {
      console.error(`  ERROR: failed to parse ${jsonPath}: ${err.message}`);
      return {};
    }
  }

  for (const metaFileName of ['_meta.ts', '_meta.js', '_meta.mjs']) {
    const codePath = join(dir, metaFileName);
    if (existsSync(codePath)) {
      try {
        const rawCode = readFileSync(codePath, 'utf-8');
        return parseMetaCode(rawCode, codePath);
      } catch (err) {
        console.error(`  ERROR: failed to parse ${codePath}: ${err.message}`);
        return {};
      }
    }
  }

  return {};
}

/**
 * Returns the set of valid nav keys for a given directory:
 * - stems of .md/.mdx/.tsx/.jsx/.js files (excluding EXCLUDED_FILES)
 * - names of immediate subdirectories that contain at least one page file
 *   or a _meta.json of their own
 */
function getNavigableKeys(dir) {
  const keys = new Set();
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return keys;
  }

  for (const entry of entries) {
    if (entry === '_meta.json') continue;

    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      // A subdirectory is a valid nav key if it has a _meta.json or contains
      // at least one navigable page file (so Nextra can render it as a section).
      const hasOwnMeta = existsSync(join(fullPath, '_meta.json'));
      const hasPageFile = readdirSync(fullPath).some((f) => {
        const ext = extname(f);
        return PAGE_EXTENSIONS.has(ext) && !EXCLUDED_FILES.has(basename(f, ext));
      });
      if (hasOwnMeta || hasPageFile) {
        keys.add(entry);
      }
    } else if (stats.isFile()) {
      const ext = extname(entry);
      if (!PAGE_EXTENSIONS.has(ext)) continue;
      const stem = basename(entry, ext);
      if (EXCLUDED_FILES.has(stem)) continue;
      keys.add(stem);
    }
  }

  return keys;
}

// ─── Checker ─────────────────────────────────────────────────────────────────

let totalOrphaned = 0;
let totalUndiscoverable = 0;

/**
 * Checks a single directory: compares its _meta.json against its file tree.
 * Recurses into immediate subdirectories that have their own _meta.json.
 */
function checkDir(dir, docsRoot) {
  const relDir = relative(docsRoot, dir) || '.';
  const meta = readMeta(dir);
  const navigable = getNavigableKeys(dir);

  // Keys declared in _meta.json (excluding separators)
  const metaKeys = Object.keys(meta).filter(
    (k) => !isSeparatorKey(k) && !isSeparatorValue(meta[k])
  );
  const metaKeySet = new Set(metaKeys);

  // ── Orphaned: in _meta.json but no file/dir backing it ───────────────────
  const orphaned = metaKeys.filter((k) => !navigable.has(k));
  if (orphaned.length > 0) {
    console.error(`\n  ORPHANED in ${relDir}/_meta.json (no matching file or directory):`);
    for (const k of orphaned) {
      console.error(`    - "${k}": "${meta[k]}"`);
    }
    totalOrphaned += orphaned.length;
  }

  // ── Undiscoverable: file/dir exists but not in _meta.json ─────────────────
  const undiscoverable = [...navigable].filter((k) => !metaKeySet.has(k));
  if (undiscoverable.length > 0) {
    console.error(`\n  UNDISCOVERABLE in ${relDir}/ (exists but missing from _meta.json):`);
    for (const k of undiscoverable) {
      console.error(`    - "${k}"`);
    }
    totalUndiscoverable += undiscoverable.length;
  }

  // ── Recurse into immediate subdirectories that have their own _meta.json ──
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory() && (existsSync(join(fullPath, '_meta.json')) || existsSync(join(fullPath, '_meta.ts')) || existsSync(join(fullPath, '_meta.js')))) {
      checkDir(fullPath, docsRoot);
    }
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isCanonical = args.includes('--canonical');
const docsDirIndex = args.indexOf('--docs-dir');
const docsDirArg = docsDirIndex !== -1 ? args[docsDirIndex + 1] : undefined;
const defaultDocsDir = isCanonical ? resolve(repoRoot, 'packages', 'docs', 'content') : resolve(repoRoot, 'docs');
const docsDir = docsDirArg ? resolve(process.cwd(), docsDirArg) : defaultDocsDir;

if (!existsSync(docsDir)) {
  console.error(`docs directory not found: ${docsDir}`);
  process.exit(1);
}

console.log(`Checking Nextra _meta.json navigation against file tree in: ${docsDir}\n`);

checkDir(docsDir, docsDir);

// ─── Summary ─────────────────────────────────────────────────────────────────

if (totalOrphaned === 0 && totalUndiscoverable === 0) {
  console.log('✓ All _meta.json files are in sync with the file tree.');
  process.exit(0);
} else {
  console.error(
    `\n✗ Found ${totalOrphaned} orphaned and ${totalUndiscoverable} undiscoverable entries.`
  );
  console.error(
    '  Fix by updating the relevant _meta.json file(s) or running:\n' + '    pnpm validate:meta-nav'
  );
  process.exit(1);
}

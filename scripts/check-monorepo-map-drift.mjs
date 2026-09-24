#!/usr/bin/env node

/**
 * monorepo-map.md package-status drift detection.
 *
 * Cross-references the "Status" column in docs/monorepo-map.md against each
 * workspace package's actual package.json metadata:
 *   - documented package name vs package.json `name`
 *   - npm `deprecated` notice vs a "Deprecated" status in the doc
 *   - a "Stable" (published) status vs a `private: true` package.json
 *   - doc rows whose path no longer exists on disk (stale rows)
 *   - workspace packages that are missing from the doc entirely
 *
 * Intentionally NON-BLOCKING by default (exit 0) so it can run in CI while the
 * status table is being reconciled. Pass `--strict` to flip it into an
 * enforcing check (exit 1 on any error-level finding) once the table is stable.
 *
 * Usage:
 *   node scripts/check-monorepo-map-drift.mjs [--strict] [--json=report.json]
 */

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { resolve, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const STATUS_KEYWORDS = ['Deprecated', 'Experimental', 'Next', 'Stable'];

// ---------------------------------------------------------------------------
// Markdown table parsing
// ---------------------------------------------------------------------------

/**
 * Parse every markdown table in `content` into structured rows.
 * Returns an array of { headers: string[], rows: string[][] }.
 */
export function parseTables(content) {
  const lines = content.split('\n');
  const tables = [];
  let headers = null;
  let inTable = false;

  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (inTable) {
        inTable = false;
        headers = null;
      }
      continue;
    }

    const cells = splitRow(line);
    const isSeparator = cells.every((c) => /^:?-+:?$/.test(c.trim()));

    if (isSeparator) continue;

    if (!headers) {
      headers = cells;
      inTable = true;
      tables.push({ headers, rows: [] });
      continue;
    }

    if (inTable) {
      tables[tables.length - 1].rows.push(cells);
    }
  }

  return tables;
}

function splitRow(line) {
  // Drop leading/trailing pipe, then split on unescaped pipes.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * Extract the package-relevant rows (those with a Path and Status column)
 * from parsed tables.
 */
export function extractPackageRows(tables) {
  const rows = [];
  for (const table of tables) {
    const pathIdx = table.headers.findIndex((h) => /path/i.test(h));
    const statusIdx = table.headers.findIndex((h) => /status/i.test(h));
    const pkgIdx = table.headers.findIndex((h) => /package/i.test(h));
    if (pathIdx === -1 || statusIdx === -1) continue;

    for (const cells of table.rows) {
      const path = strip(cellAt(cells, pathIdx));
      const statusText = strip(cellAt(cells, statusIdx));
      const pkg = pkgIdx === -1 ? '' : strip(cellAt(cells, pkgIdx));
      if (!path) continue;
      rows.push({ path, statusText, status: normalizeStatus(statusText), pkg });
    }
  }
  return rows;
}

function cellAt(cells, idx) {
  return cells[idx] ?? '';
}

function strip(s) {
  return s.replace(/[`*]/g, '').trim();
}

/**
 * Map a free-form status cell to one of the canonical keywords, or null.
 */
export function normalizeStatus(text) {
  const lower = text.toLowerCase();
  for (const kw of STATUS_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

function parseYamlList(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const items = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^-\s+['"]?([^'"]+)['"]?$/);
    if (match) items.push(match[1]);
  }
  return items;
}

function resolveWorkspaceDirs(patterns) {
  const dirs = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const baseDir = pattern.slice(0, -2);
      const fullBase = resolve(rootDir, baseDir);
      if (existsSync(fullBase)) {
        for (const entry of readdirSync(fullBase, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            dirs.push(resolve(fullBase, entry.name) + sep);
          }
        }
      }
    } else {
      const fullPath = resolve(rootDir, pattern);
      if (existsSync(fullPath)) dirs.push(fullPath + sep);
    }
  }
  return [...new Set(dirs)];
}

function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
}

// ---------------------------------------------------------------------------
// Drift analysis
// ---------------------------------------------------------------------------

/**
 * Build findings from already-parsed doc rows + a map of path -> pkg.json
 * object (or null when absent).
 *
 * @param {Array<{path:string, pkg:string, statusText:string, status:string|null}>} docRows
 * @param {Map<string, object|null>} packages  keyed by normalized doc-relative path
 */
export function buildFindings(docRows, packages) {
  const findings = [];

  for (const row of docRows) {
    const normPath = normalizePath(row.path);
    const isDocRoot = row.path === '.' || row.path === './';

    // Skip non-filesystem logical entries (e.g. the repo root row).
    if (!isDocRoot && !packages.has(normPath) && !pathExists(normPath)) {
      findings.push({
        level: 'error',
        code: 'STALE_DOC_ROW',
        message: `Doc references "${row.path}" which does not exist on disk.`,
        docPath: row.path,
      });
      continue;
    }

    const pkg = packages.get(normPath);
    if (!pkg) {
      // Documented path exists but carries no package.json.
      if (pathExists(normPath)) {
        findings.push({
          level: 'warning',
          code: 'NO_PACKAGE_JSON',
          message: `Documented path "${row.path}" has no package.json.`,
          docPath: row.path,
        });
      }
      continue;
    }

    // 1. Name mismatch.
    if (row.pkg && pkg.name && row.pkg !== pkg.name) {
      findings.push({
        level: 'error',
        code: 'NAME_MISMATCH',
        message: `Doc package name "${row.pkg}" does not match package.json name "${pkg.name}" for "${row.path}".`,
        docPath: row.path,
        actual: pkg.name,
        documented: row.pkg,
      });
    }

    // 2. npm deprecation notice vs documented Deprecated status.
    const isDeprecatedInPkg = Boolean(pkg.deprecated);
    if (isDeprecatedInPkg && row.status !== 'Deprecated') {
      findings.push({
        level: 'error',
        code: 'DEPRECATED_NOT_IN_DOC',
        message: `package.json for "${row.path}" is deprecated (${JSON.stringify(
          pkg.deprecated
        )}) but the doc status is "${row.statusText}".`,
        docPath: row.path,
      });
    }
    if (!isDeprecatedInPkg && row.status === 'Deprecated') {
      findings.push({
        level: 'warning',
        code: 'DEPRECATED_DOC_ONLY',
        message: `Doc marks "${row.path}" as Deprecated but package.json has no deprecation notice.`,
        docPath: row.path,
      });
    }

    // 3. Configured for public publish but flagged private — a real publish
    //    contradiction (not merely an internal/private package marked Stable,
    //    where "Stable" denotes maturity rather than publishability).
    const publishAccess = pkg.publishConfig && pkg.publishConfig.access;
    if (pkg.private === true && publishAccess === 'public') {
      findings.push({
        level: 'warning',
        code: 'PUBLISH_INTENT_PRIVATE',
        message: `package.json for "${row.path}" sets publishConfig.access: "public" but also private: true (doc status: "${row.statusText}").`,
        docPath: row.path,
      });
    }
  }

  // 4. Undocumented workspace packages.
  const documentedPaths = new Set(docRows.map((r) => normalizePath(r.path)));
  for (const [normPath, pkg] of packages) {
    if (!pkg) continue;
    if (!documentedPaths.has(normPath)) {
      findings.push({
        level: 'warning',
        code: 'UNDOCUMENTED_PACKAGE',
        message: `Workspace package "${normPath}" (${pkg.name}) is not listed in docs/monorepo-map.md.`,
        docPath: normPath,
        actual: pkg.name,
      });
    }
  }

  return findings;
}

function pathExists(normPath) {
  try {
    return statSync(resolve(rootDir, normPath)).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export function analyze({ docContent, packages }) {
  const tables = parseTables(docContent);
  const docRows = extractPackageRows(tables);
  const findings = buildFindings(docRows, packages);
  return { docRows, findings };
}

export async function run({ strict = false, jsonPath = null } = {}) {
  const docPath = resolve(rootDir, 'docs', 'monorepo-map.md');
  const docContent = readFileSync(docPath, 'utf-8');

  // Discover workspace packages and load their package.json.
  const wsYaml = resolve(rootDir, 'pnpm-workspace.yaml');
  const patterns = existsSync(wsYaml) ? parseYamlList(wsYaml) : [];
  const dirs = resolveWorkspaceDirs(patterns);
  const packages = new Map();
  for (const dir of dirs) {
    const pkgPath = resolve(dir, 'package.json');
    const normPath = normalizePath(relative(rootDir, dir));
    packages.set(normPath, existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf-8')) : null);
  }

  const { docRows, findings } = analyze({ docContent, packages });

  printReport(docRows, findings);

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ docRows, findings }, null, 2));
  }

  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warning');

  if (strict && errors.length > 0) {
    process.exitCode = 1;
  }
  return { docRows, findings, errors, warnings };
}

function printReport(docRows, findings) {
  console.log(`\nMonorepo-map drift check — ${docRows.length} documented package rows\n`);
  if (findings.length === 0) {
    console.log('✅ No drift detected between docs/monorepo-map.md and package.json metadata.\n');
    return;
  }
  const order = { error: 0, warning: 1 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  for (const f of sorted) {
    const icon = f.level === 'error' ? '❌' : '⚠️ ';
    console.log(`${icon} [${f.code}] ${f.message}`);
  }
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warning').length;
  console.log(`\n${errors} error(s), ${warnings} warning(s).\n`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  const strict = process.argv.includes('--strict');
  const jsonArg = process.argv.find((a) => a.startsWith('--json='));
  const jsonPath = jsonArg ? jsonArg.slice('--json='.length) : null;
  run({ strict, jsonPath }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

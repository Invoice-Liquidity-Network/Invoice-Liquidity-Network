#!/usr/bin/env node

/**
 * Monorepo package.json validation script.
 *
 * Checks every workspace package for:
 *   name, version, engines.node (>=20), license (MIT),
 *   and that main/types point to resolvable files.
 *
 * Usage: node scripts/validate-packages.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NAME_IGNORE_PATTERNS = [
  'examples/',
  'docs/',
  'packages/docs/',
  'notifications',
  'indexer',
  'cli',
];

const NO_MAIN_TYPES_ALLOWED = [
  'packages/eslint-config/',
  'packages/scripts/',
  'packages/docs/',
  'docs/',
  'notifications/',
];

const BUILD_SCRIPT_PATTERNS = ['build', 'bundle', 'compile'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function relPath(absolute) {
  return relative(rootDir, absolute).replace(/\\/g, '/');
}

function fileExists(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function parseYamlList(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const items = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^-\s+"?([^"]+)"?$/);
    if (match) {
      items.push(match[1]);
    }
  }
  return items;
}

function hasBuildScript(pkg) {
  if (!pkg.scripts) return false;
  return BUILD_SCRIPT_PATTERNS.some((pattern) =>
    Object.keys(pkg.scripts).some((key) => key.includes(pattern))
  );
}

function isIgnoredName(relative) {
  return NAME_IGNORE_PATTERNS.some((pattern) => relative.startsWith(pattern));
}

function isNoMainTypes(relative) {
  return NO_MAIN_TYPES_ALLOWED.some((pattern) => relative.startsWith(pattern));
}

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

function resolveWorkspaceDirs(patterns) {
  const dirs = [];

  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const baseDir = pattern.slice(0, -2);
      const fullBase = resolve(rootDir, baseDir);
      if (existsSync(fullBase)) {
        for (const entry of readdirSync(fullBase, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            dirs.push(resolve(fullBase, entry.name));
          }
        }
      }
    } else {
      const fullPath = resolve(rootDir, pattern);
      if (existsSync(fullPath)) {
        dirs.push(fullPath);
      }
    }
  }

  return dirs;
}

function discoverWorkspacePackages() {
  const wsYaml = resolve(rootDir, 'pnpm-workspace.yaml');
  const patterns = existsSync(wsYaml) ? parseYamlList(wsYaml) : [];

  const rootPkgPath = resolve(rootDir, 'package.json');
  const rootPkg = readJson(rootPkgPath);
  if (rootPkg.workspaces) {
    for (const w of rootPkg.workspaces) {
      if (!patterns.includes(w)) patterns.push(w);
    }
  }

  const workspaceDirs = [...new Set(resolveWorkspaceDirs(patterns))];
  const pkgJsonFiles = [];

  for (const dir of workspaceDirs) {
    const pkgPath = resolve(dir, 'package.json');
    if (existsSync(pkgPath)) {
      pkgJsonFiles.push(pkgPath);
    }
  }

  return pkgJsonFiles;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

let totalViolations = 0;

function report(file, field, message) {
  console.error(`  ❌ ${relPath(file)} — ${field}: ${message}`);
  totalViolations++;
}

function validatePackage(pkgPath) {
  const pkg = readJson(pkgPath);
  const relative = relPath(pkgPath);

  // 1. Name starts with @iln/
  if (!isIgnoredName(relative)) {
    if (!pkg.name) {
      report(pkgPath, 'name', 'missing');
    } else if (!pkg.name.startsWith('@iln/')) {
      report(pkgPath, 'name', `"${pkg.name}" should start with @iln/`);
    }
  }

  // 2. Version present (unless private)
  if (!pkg.private && !pkg.version) {
    report(pkgPath, 'version', 'missing');
  }

  // 3. engines.node >=20
  const nodeRange = pkg.engines?.node;
  if (!nodeRange) {
    report(pkgPath, 'engines.node', 'missing');
  } else if (!nodeRange.includes('>=20')) {
    report(pkgPath, 'engines.node', `"${nodeRange}" should include >=20`);
  }

  // 4. license === MIT
  if (!pkg.license) {
    report(pkgPath, 'license', 'missing');
  } else if (pkg.license !== 'MIT') {
    report(pkgPath, 'license', `"${pkg.license}" should be MIT`);
  }

  // 5. main points to existing file (or has build, or is exempt)
  if (!isNoMainTypes(relative)) {
    if (pkg.main) {
      const mainPath = resolve(dirname(pkgPath), pkg.main);
      if (!fileExists(mainPath) && !hasBuildScript(pkg)) {
        report(pkgPath, 'main', `"${pkg.main}" does not exist and no build script`);
      }
    }

    if (pkg.types) {
      const typesPath = resolve(dirname(pkgPath), pkg.types);
      if (!fileExists(typesPath) && !hasBuildScript(pkg)) {
        report(pkgPath, 'types', `"${pkg.types}" does not exist and no build script`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const pkgFiles = discoverWorkspacePackages();
  console.log(`Found ${pkgFiles.length} workspace package.json files\n`);

  for (const pkgFile of pkgFiles) {
    validatePackage(pkgFile);
  }

  console.log(`\nTotal violations: ${totalViolations}`);

  if (totalViolations > 0) {
    process.exit(1);
  }
}

main();

#!/usr/bin/env node

/**
 * Flags workspace packages that transitively depend on something changed in
 * this PR but are not covered by any changeset added in the same PR.
 *
 * changeset-check.yml already fails the build when packages/**\/sdk/** change
 * without any changeset. This script does not duplicate that — it is
 * advisory only, because packages/shared (and any other internal dependency)
 * can affect several downstream workspaces, and @changesets/cli's
 * `updateInternalDependencies` setting only bumps a dependent automatically
 * once *some* changeset triggers a release; it does not tell reviewers which
 * dependents to double-check for their own changelog entry today.
 *
 * Usage: node scripts/check-changeset-dependents.mjs [base-ref]
 */

import { readFileSync, existsSync, readdirSync, appendFileSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const INTERNAL_SCOPES = ['@iln/', '@invoice-liquidity/'];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function relPath(absolutePath) {
  return relative(rootDir, absolutePath).replace(/\\/g, '/');
}

function parseYamlList(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const items = [];
  for (const line of content.split('\n')) {
    const match = line.trim().match(/^-\s+"?([^"]+)"?$/);
    if (match) items.push(match[1]);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Workspace discovery (mirrors scripts/validate-packages.mjs)
// ---------------------------------------------------------------------------

function resolveWorkspaceDirs(patterns) {
  const dirs = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const fullBase = resolve(rootDir, pattern.slice(0, -2));
      if (existsSync(fullBase)) {
        for (const entry of readdirSync(fullBase, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            dirs.push(resolve(fullBase, entry.name));
          }
        }
      }
    } else {
      const fullPath = resolve(rootDir, pattern);
      if (existsSync(fullPath)) dirs.push(fullPath);
    }
  }
  return dirs;
}

function discoverWorkspacePackages() {
  const wsYaml = resolve(rootDir, 'pnpm-workspace.yaml');
  const patterns = existsSync(wsYaml) ? parseYamlList(wsYaml) : [];

  const rootPkg = readJson(resolve(rootDir, 'package.json'));
  for (const w of rootPkg.workspaces ?? []) {
    if (!patterns.includes(w)) patterns.push(w);
  }

  const pkgJsonFiles = [];
  for (const dir of new Set(resolveWorkspaceDirs(patterns))) {
    const pkgPath = resolve(dir, 'package.json');
    if (existsSync(pkgPath)) pkgJsonFiles.push(pkgPath);
  }
  return pkgJsonFiles;
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

function isInternalDep(name) {
  return INTERNAL_SCOPES.some((scope) => name.startsWith(scope));
}

function buildGraph() {
  const dirOfName = new Map();
  const internalDepsOfName = new Map();

  for (const pkgPath of discoverWorkspacePackages()) {
    const pkg = readJson(pkgPath);
    if (!pkg.name) continue;
    const dir = relPath(dirname(pkgPath));
    dirOfName.set(pkg.name, dir);
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    internalDepsOfName.set(
      pkg.name,
      new Set(Object.keys(allDeps).filter(isInternalDep)),
    );
  }

  return { dirOfName, internalDepsOfName };
}

function changedFiles(baseRef) {
  return execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
    cwd: rootDir,
  })
    .toString()
    .split('\n')
    .filter(Boolean);
}

function changesetCoveredPackages(changed) {
  const covered = new Set();
  for (const file of changed) {
    if (!/^\.changeset\/.+\.md$/.test(file)) continue;
    const fullPath = resolve(rootDir, file);
    if (!existsSync(fullPath)) continue; // changeset removed in this PR
    const frontmatter = readFileSync(fullPath, 'utf-8').match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) continue;
    for (const line of frontmatter[1].split('\n')) {
      const match = line.match(/^"([^"]+)":/);
      if (match) covered.add(match[1]);
    }
  }
  return covered;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const baseRef = process.argv[2] || 'origin/main';
  const { dirOfName, internalDepsOfName } = buildGraph();
  const changed = changedFiles(baseRef);

  const touched = new Set();
  for (const [name, dir] of dirOfName) {
    if (changed.some((f) => f === dir || f.startsWith(`${dir}/`))) {
      touched.add(name);
    }
  }

  if (touched.size === 0) {
    console.log('No workspace package sources changed — nothing to flag.');
    return;
  }

  // Reverse dependency BFS: everything that transitively depends on a
  // touched package, however many internal hops away. Example apps under
  // examples/ consume packages via "file:" deps but are never published and
  // never receive changesets, so they are excluded from "affected".
  const affected = new Set();
  const queue = [...touched];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const [name, deps] of internalDepsOfName) {
      if (dirOfName.get(name)?.startsWith('examples/')) continue;
      if (deps.has(current) && !affected.has(name) && !touched.has(name)) {
        affected.add(name);
        queue.push(name);
      }
    }
  }

  if (affected.size === 0) {
    console.log('No other workspace package depends on the packages changed in this PR.');
    return;
  }

  const covered = changesetCoveredPackages(changed);
  const missing = [...affected].filter((name) => !covered.has(name));

  if (missing.length === 0) {
    console.log('All downstream dependents are already covered by a changeset in this PR.');
    return;
  }

  console.log('');
  console.log('These workspace packages depend (directly or transitively) on something');
  console.log('changed in this PR but are not covered by a changeset yet:');
  console.log('');
  for (const name of missing) {
    console.log(`  - ${name} (${dirOfName.get(name)})`);
  }
  console.log('');
  console.log('This is advisory only — confirm with a reviewer whether any of these');
  console.log('need their own changeset. See CONTRIBUTING.md#changeset-workflow.');

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '### Changeset dependent check',
      '',
      'These workspace packages depend on something changed in this PR but are',
      'not yet covered by a changeset (advisory — confirm during review):',
      '',
      ...missing.map((name) => `- \`${name}\` (${dirOfName.get(name)})`),
    ];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}

main();

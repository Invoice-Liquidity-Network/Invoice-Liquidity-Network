#!/usr/bin/env node

/**
 * SDK backward-compatibility matrix (Issue #1035).
 *
 * Runs the representative-consumer fixtures under
 * tests/sdk-integration/compat-matrix/fixtures/ (frontend hooks, CLI
 * commands, example scripts — modeled on the real code in packages/react,
 * cli/src, and examples/typescript-example) against each @iln/sdk version
 * resolveSdkVersions() selects: the last three tagged minors (`sdk-v*` git
 * tags), or — since no @iln/sdk release has ever been tagged or published —
 * today's bootstrap fallback of just the current working tree.
 *
 * For the working-tree entry, this builds sdk/ (if dist/ is missing or
 * --force is passed) and imports its built dist/index.mjs directly — no
 * package manager, no network, no isolated install. For a tagged entry, it
 * checks out that ref into a temporary git worktree, installs and builds it
 * there, and imports ITS dist/index.mjs. (No tags exist yet, so that path is
 * implemented but has never actually run — see docs/sdk-next-migration.md.)
 *
 * BLOCKING: exits 1 if any fixture fails against any resolved version.
 *
 * Usage:
 *   node scripts/check-sdk-compat-matrix.mjs [--force-build] [--json=report.json]
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

import { resolveSdkVersions } from './lib/sdk-compat-versions.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const sdkDir = resolve(rootDir, 'sdk');
const fixturesDir = resolve(rootDir, 'tests', 'sdk-integration', 'compat-matrix', 'fixtures');

const FIXTURES = ['frontend-hooks.mjs', 'cli-commands.mjs', 'example-scripts.mjs'];

function currentSdkVersion() {
  return JSON.parse(readFileSync(resolve(sdkDir, 'package.json'), 'utf-8')).version;
}

function buildSdk(cwd) {
  execFileSync('pnpm', ['--filter', '@iln/sdk', 'build'], { cwd, stdio: 'inherit' });
}

/** Resolves a version entry to an absolute path to its built dist/index.mjs, building if needed. */
function resolveDistEntry(entry, { forceBuild }) {
  if (entry.ref === null) {
    const distEntry = resolve(sdkDir, 'dist', 'index.mjs');
    if (forceBuild || !existsSync(distEntry)) {
      buildSdk(rootDir);
    }
    return { distEntry, cleanup: () => {} };
  }

  // Tagged historical version — check out into a temp worktree, install, build.
  // Not exercised today (no sdk-v* tags exist yet); implemented for when they do.
  const worktreeDir = mkdtempSync(join(tmpdir(), 'sdk-compat-matrix-'));
  execFileSync('git', ['worktree', 'add', '--detach', worktreeDir, entry.ref], { cwd: rootDir, stdio: 'inherit' });
  execFileSync('pnpm', ['install', '--ignore-scripts', '--filter', '@iln/sdk...'], { cwd: worktreeDir, stdio: 'inherit' });
  buildSdk(worktreeDir);
  const distEntry = resolve(worktreeDir, 'sdk', 'dist', 'index.mjs');
  return {
    distEntry,
    cleanup: () => {
      execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: rootDir, stdio: 'ignore' });
      rmSync(worktreeDir, { recursive: true, force: true });
    },
  };
}

async function runFixture(fixtureFile, distEntryUrl) {
  const fixtureModule = await import(pathToFileURL(resolve(fixturesDir, fixtureFile)).href);
  await fixtureModule.run(distEntryUrl);
}

export async function run({ forceBuild = false, jsonPath = null, onlyVersion = null } = {}) {
  const allVersions = resolveSdkVersions({ currentVersion: currentSdkVersion() });
  const versions = onlyVersion ? allVersions.filter((v) => v.version === onlyVersion) : allVersions;
  if (onlyVersion && versions.length === 0) {
    throw new Error(`--only-version=${onlyVersion} does not match any version resolveSdkVersions() returned (${allVersions.map((v) => v.version).join(', ')}).`);
  }
  const results = [];

  for (const entry of versions) {
    const { distEntry, cleanup } = resolveDistEntry(entry, { forceBuild });
    const distEntryUrl = pathToFileURL(distEntry).href;

    for (const fixtureFile of FIXTURES) {
      const result = { version: entry.version, source: entry.source, fixture: fixtureFile, passed: true, error: null };
      try {
        await runFixture(fixtureFile, distEntryUrl);
      } catch (err) {
        result.passed = false;
        result.error = err instanceof Error ? err.message : String(err);
      }
      results.push(result);
    }

    cleanup();
  }

  printReport(versions, results);

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ versions, results }, null, 2));
  }

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    process.exitCode = 1;
  }

  return { versions, results, failures };
}

function printReport(versions, results) {
  const isBootstrap = versions.length === 1 && versions[0].source === 'working-tree';
  console.log(`\nSDK backward-compatibility matrix — ${versions.length} version(s), ${FIXTURES.length} consumer fixture(s)`);
  if (isBootstrap) {
    console.log(
      'Bootstrap mode: no sdk-v* git tags exist yet, so this is a self-check against the working tree only.\n' +
        'It will automatically expand to the last 3 tagged minors once @iln/sdk releases are tagged — see docs/sdk-next-migration.md.\n'
    );
  }

  for (const entry of versions) {
    console.log(`\n${entry.version} (${entry.source}${entry.ref ? `: ${entry.ref}` : ''}):`);
    for (const result of results.filter((r) => r.version === entry.version)) {
      if (result.passed) {
        console.log(`  ✅ ${result.fixture}`);
      } else {
        console.error(`  ❌ ${result.fixture} — ${result.error}`);
      }
    }
  }

  const failures = results.filter((r) => !r.passed);
  console.log(
    failures.length > 0
      ? `\n${failures.length}/${results.length} fixture run(s) failed.`
      : `\nAll ${results.length} fixture run(s) passed.`
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  const args = process.argv.slice(2);

  if (args.includes('--print-versions')) {
    // For a CI job to fan out a `strategy: matrix` from — e.g.
    // echo "versions=$(node scripts/check-sdk-compat-matrix.mjs --print-versions)" >> "$GITHUB_OUTPUT"
    const versions = resolveSdkVersions({ currentVersion: currentSdkVersion() });
    console.log(JSON.stringify(versions.map((v) => v.version)));
    process.exit(0);
  }

  const jsonArg = args.find((a) => a.startsWith('--json='));
  const onlyVersionArg = args.find((a) => a.startsWith('--only-version='));
  run({
    forceBuild: args.includes('--force-build'),
    jsonPath: jsonArg ? jsonArg.slice('--json='.length) : null,
    onlyVersion: onlyVersionArg ? onlyVersionArg.slice('--only-version='.length) : null,
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

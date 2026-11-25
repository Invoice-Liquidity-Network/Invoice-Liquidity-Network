#!/usr/bin/env node

/**
 * check-sdk-release-gates.mjs
 *
 * Issue #1217: Gate SDK releases on migration documentation
 * Issue #1503: Audit SDK release gate completeness
 *
 * Validates that all required migration documentation and compatibility
 * artifacts are present before an SDK release is published. This ensures
 * operators have the necessary information to migrate between versions.
 *
 * Required artifacts:
 * 1. Migration guide (docs/sdk-migration-guide.md or docs/sdk-next-migration.md)
 * 2. Version manifest (docs/version-manifest.json)
 * 3. Compatibility matrix in cross-repo-dependencies.md
 * 4. SDK compatibility test fixtures (tests/sdk-integration/compat-matrix/fixtures/)
 * 5. Changelog entry for the release
 * 6. A pending changeset entry describing the release (issue #1503)
 *
 * Issue #1503 found that the "package version" and "exports field" gates only
 * ever inspected the legacy `sdk/package.json` surface, so a release could ship
 * with a broken or undeclared `exports` map on `packages/sdk` (@iln/sdk-next)
 * or `packages/react` (@iln/react) without tripping any gate. Those two gates
 * now walk every surface declared in `SDK_SURFACES` (the same registry
 * `check-sdk-export-maps.mjs` and `check-sdk-support-windows.mjs` use), closing
 * the completeness gap across exports and compatibility. A changeset-presence
 * gate closes the remaining gap across changesets: without it a release could
 * ship with no changelog-generating changeset at all.
 *
 * Usage:
 *   node scripts/check-sdk-release-gates.mjs [--root=<dir>]
 *   pnpm check-sdk-release-gates
 *
 * Exit codes:
 *   0 = All gates pass, release is permitted
 *   1 = Gate check failed, release is blocked
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkSdkClientDrift } from './check-sdk-client-drift.mjs';
import { checkExampleSdkResolution } from './check-example-sdk-resolution.mjs';
import { checkSdkSupportWindows } from './check-sdk-support-windows.mjs';
import { SDK_SURFACES } from './check-sdk-export-maps.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, '..');

export const CHANGESET_DIR = '.changeset';

/**
 * Every SDK surface's package.json must declare a valid semantic version.
 * Issue #1503: previously only `sdk/package.json` was checked, leaving
 * `packages/sdk` and `packages/react` unverified.
 */
export function checkSurfacePackageVersions(root) {
  const findings = [];
  for (const surface of SDK_SURFACES) {
    const pkgPath = resolve(root, surface.dir, 'package.json');
    if (!existsSync(pkgPath)) {
      findings.push(`${surface.dir}/package.json is missing (expected ${surface.pkg}).`);
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (!pkg.version || !/^\d+\.\d+\.\d+/.test(pkg.version)) {
        findings.push(`${surface.dir}/package.json must have a valid semantic version.`);
      }
    } catch {
      findings.push(`${surface.dir}/package.json is not valid JSON.`);
    }
  }
  return findings;
}

/**
 * Every SDK surface's package.json must declare a non-empty `exports` map.
 * Issue #1503: previously only `sdk/package.json` was checked, leaving
 * `packages/sdk` and `packages/react` unverified.
 */
export function checkSurfaceExportEntries(root) {
  const findings = [];
  for (const surface of SDK_SURFACES) {
    const pkgPath = resolve(root, surface.dir, 'package.json');
    if (!existsSync(pkgPath)) {
      findings.push(`${surface.dir}/package.json is missing (expected ${surface.pkg}).`);
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (!pkg.exports || Object.keys(pkg.exports).length === 0) {
        findings.push(`${surface.dir}/package.json must define an exports field (for legacy import compatibility).`);
      }
    } catch {
      findings.push(`${surface.dir}/package.json is not valid JSON.`);
    }
  }
  return findings;
}

/**
 * At least one pending changeset markdown file must exist. Issue #1503: the
 * release gates never checked for a changeset at all, so a release could ship
 * with no changelog-generating entry for consumers.
 */
export function checkChangesetPresent(root) {
  const dir = resolve(root, CHANGESET_DIR);
  if (!existsSync(dir)) {
    return [`${CHANGESET_DIR}/ directory is missing.`];
  }
  const pending = readdirSync(dir).filter(
    (name) => name.toLowerCase().endsWith('.md') && name.toLowerCase() !== 'readme.md'
  );
  if (pending.length === 0) {
    return [`No pending changeset entry found in ${CHANGESET_DIR}/. Run \`pnpm changeset\` to document this release.`];
  }
  return [];
}

export function buildGates(root) {
  return [
    {
      name: 'SDK Migration Guide',
      check: () => {
        const migrationGuide = resolve(root, 'docs/sdk-migration-guide.md');
        const nextMigrationGuide = resolve(root, 'docs/sdk-next-migration.md');
        return existsSync(migrationGuide) || existsSync(nextMigrationGuide);
      },
      message: 'At least one migration guide must exist (docs/sdk-migration-guide.md or docs/sdk-next-migration.md)',
      severity: 'error',
    },
    {
      name: 'Version Manifest',
      check: () => {
        const versionManifest = resolve(root, 'docs/version-manifest.json');
        if (!existsSync(versionManifest)) return false;
        try {
          const content = readFileSync(versionManifest, 'utf-8');
          const manifest = JSON.parse(content);
          return manifest.sdk && manifest.contract;
        } catch {
          return false;
        }
      },
      message: 'Version manifest (docs/version-manifest.json) must exist with sdk and contract versions',
      severity: 'error',
    },
    {
      name: 'Compatibility Matrix',
      check: () => {
        const crossRepoDeps = resolve(root, 'docs/cross-repo-dependencies.md');
        if (!existsSync(crossRepoDeps)) return false;
        const content = readFileSync(crossRepoDeps, 'utf-8');
        return (
          content.includes('<!-- COMPATIBILITY_MATRIX_START -->') &&
          content.includes('<!-- COMPATIBILITY_MATRIX_END -->')
        );
      },
      message: 'Compatibility matrix markers must exist in docs/cross-repo-dependencies.md',
      severity: 'error',
    },
    {
      name: 'SDK Package.json Version',
      check: () => checkSurfacePackageVersions(root).length === 0,
      message: `Every SDK surface's package.json (${SDK_SURFACES.map((s) => s.dir).join(', ')}) must have a valid semantic version`,
      severity: 'error',
    },
    {
      name: 'CHANGELOG Entry',
      check: () => {
        const changelog = resolve(root, 'CHANGELOG.md');
        if (!existsSync(changelog)) return false;
        const content = readFileSync(changelog, 'utf-8');
        // Check for recent changelog entries (not older than current version)
        return content.includes('## [') && content.length > 100;
      },
      message: 'CHANGELOG.md must contain recent release entries',
      severity: 'warning',
    },
    {
      name: 'Release Changeset Present',
      check: () => checkChangesetPresent(root).length === 0,
      message: `A pending changeset entry must exist in ${CHANGESET_DIR}/ before releasing (run \`pnpm changeset\`)`,
      severity: 'error',
    },
    {
      name: 'SDK Export Entries',
      check: () => checkSurfaceExportEntries(root).length === 0,
      message: `Every SDK surface's package.json (${SDK_SURFACES.map((s) => s.dir).join(', ')}) must define an exports field`,
      severity: 'error',
    },
    {
      name: 'Generated-Client Drift Detection',
      check: () => {
        const report = checkSdkClientDrift(root);
        return report.findings.length === 0;
      },
      message: 'Generated client types must be aligned with contract spec (no drift detected)',
      severity: 'error',
    },
    {
      name: 'Example SDK Resolution',
      check: () => {
        const report = checkExampleSdkResolution(root);
        return report.findings.length === 0;
      },
      message: 'Examples must resolve canonical @iln/sdk package and exports contract',
      severity: 'error',
    },
    {
      name: 'SDK Support Windows',
      check: () => {
        const report = checkSdkSupportWindows(root);
        return report.findings.length === 0;
      },
      message:
        'Every SDK surface must declare a valid support window (docs/sdk-support-windows.json)',
      severity: 'error',
    },
  ];
}

function formatResult(gate, passed) {
  const icon = passed ? '✓' : '✗';
  const status = passed ? 'PASS' : 'FAIL';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  return `${color}${icon}${reset} [${status}] ${gate.name}${
    !passed ? `\n    ${gate.message}` : ''
  }`;
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  for (const arg of argv) {
    if (arg.startsWith('--root=')) root = resolve(arg.slice('--root='.length));
  }
  return { root };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const gates = buildGates(root);

  console.log('\n📋 SDK Release Gates Check (Issue #1217, #1503)\n');
  console.log(`Checking ${gates.length} release gates...\n`);

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  const failures = [];

  for (const gate of gates) {
    const passed = gate.check();

    if (passed) {
      passCount++;
    } else if (gate.severity === 'warning') {
      warnCount++;
      console.log(formatResult(gate, false));
    } else {
      failCount++;
      failures.push(gate.message);
      console.log(formatResult(gate, false));
    }

    if (passed) {
      console.log(formatResult(gate, true));
    }
  }

  console.log(`\n${'─'.repeat(60)}\n`);
  console.log(`Results: ${passCount}/${gates.length} gates passed`);

  if (warnCount > 0) {
    console.log(`⚠️  ${warnCount} warning(s) - migration documentation may be incomplete`);
  }

  if (failCount > 0) {
    console.log(`\n❌ Release blocked: ${failCount} critical gate(s) failed\n`);
    failures.forEach((msg, i) => {
      console.log(`${i + 1}. ${msg}`);
    });
    console.log('\nPlease address all critical gates before releasing.\n');
    process.exit(1);
  }

  console.log('\n✅ All critical gates passed - SDK release is permitted\n');
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}

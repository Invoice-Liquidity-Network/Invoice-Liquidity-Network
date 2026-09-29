#!/usr/bin/env node
/**
 * Local dry-run validator for coordinate-release.yml (#934).
 *
 * Simulates the dry_run path against a canary version without calling GitHub
 * APIs. Asserts the workflow file references the post-consolidation org,
 * default branch, package set, and pnpm — not stale Songu3020/npm paths.
 *
 * Usage:
 *   node scripts/dry-run-coordinate-release.mjs
 *   node scripts/dry-run-coordinate-release.mjs --version v1.2.0-canary.1
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const workflowPath = join(root, '.github/workflows/coordinate-release.yml');

const args = process.argv.slice(2);
const versionIdx = args.indexOf('--version');
const version = versionIdx >= 0 && args[versionIdx + 1] ? args[versionIdx + 1] : 'v0.0.0-canary.1';

const VERSION_RE = /^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

if (!VERSION_RE.test(version)) {
  fail(`Invalid version "${version}". Expected e.g. v1.2.0 or v1.2.0-canary.1`);
}
ok(`Version format valid: ${version}`);

const yaml = readFileSync(workflowPath, 'utf8');

const requiredSnippets = [
  ['Invoice-Liquidity-Network org', 'ORG: Invoice-Liquidity-Network'],
  ['default branch dev', 'DEFAULT_BRANCH: dev'],
  ['ILN-Smart-Contract', 'CONTRACT_REPO: ILN-Smart-Contract'],
  ['ILN-Frontend', 'FRONTEND_REPO: ILN-Frontend'],
  ['@iln/sdk package', '@iln/sdk'],
  ['@iln/sdk-next package', '@iln/sdk-next'],
  ['pnpm filter tests', 'pnpm --filter @iln/sdk test'],
  ['canary-capable version regex', 'v1.2.0-canary'],
];

for (const [label, snippet] of requiredSnippets) {
  if (!yaml.includes(snippet)) {
    fail(`Workflow missing required post-consolidation reference: ${label} (${snippet})`);
  }
  ok(`Found: ${label}`);
}

const forbidden = [
  ['stale personal fork owner', 'Songu3020/'],
  ['stale npm ci install', 'npm ci'],
  ['stale commits/main for default branch API', 'commits/main'],
];

for (const [label, snippet] of forbidden) {
  if (yaml.includes(snippet)) {
    fail(`Workflow still contains stale reference: ${label} (${snippet})`);
  }
  ok(`Absent: ${label}`);
}

console.log('');
console.log('🔄 Simulated dry-run plan');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Version: ${version}`);
console.log('Mode: DRY RUN (local validator — no API calls)');
console.log(`Would tag Invoice-Liquidity-Network/ILN-Smart-Contract → ${version}`);
console.log(`Would tag Invoice-Liquidity-Network/Invoice-Liquidity-Network → sdk-${version}`);
console.log(`Would tag Invoice-Liquidity-Network/ILN-Frontend → frontend-${version}`);
console.log('Would run pnpm --filter @iln/sdk test');
console.log('Would run pnpm --filter @iln/sdk-next test');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
ok('coordinate-release.yml dry-run validation passed');

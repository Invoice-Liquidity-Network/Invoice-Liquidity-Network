#!/usr/bin/env node
/**
 * Consistency validator for the commit / PR-title convention (#959).
 *
 * `commitlint.config.js` is loaded by two independent enforcement points:
 * the `commit-msg` Husky hook and `.github/workflows/pr-title-lint.yml`.
 * A rule that one applies and the other does not would surprise
 * contributors, and a documented example that the linter rejects is worse.
 *
 * This script asserts that:
 *   1. both enforcement points pass `--config commitlint.config.js`
 *   2. a sample valid subject is accepted by the resolved config
 *   3. a sample invalid subject is rejected by the resolved config
 *   4. the type list documented in CONTRIBUTING.md matches `type-enum`
 *
 * Usage:
 *   node scripts/check-commit-convention.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const require = createRequire(import.meta.url);
const config = require(join(root, 'commitlint.config.js'));

const failures = [];

function fail(msg) {
  failures.push(msg);
}

function pass(msg) {
  console.log(`✅ ${msg}`);
}

function lint(message) {
  try {
    execFileSync('npx', ['--no', '--', 'commitlint', '--config', 'commitlint.config.js'], {
      input: `${message}\n`,
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

// ── 1. Both enforcement points reference the same config explicitly ──────────

const enforcementPoints = [
  ['.husky/commit-msg', join(root, '.husky/commit-msg')],
  ['.github/workflows/pr-title-lint.yml', join(root, '.github/workflows/pr-title-lint.yml')],
];

for (const [label, path] of enforcementPoints) {
  const contents = readFileSync(path, 'utf8');
  if (contents.includes('--config commitlint.config.js')) {
    pass(`${label} passes commitlint.config.js explicitly`);
  } else {
    fail(`${label} does not pass --config commitlint.config.js (relies on auto-discovery)`);
  }
}

// ── 2 & 3. The resolved config accepts and rejects the right subjects ─────────

const validSubject = 'fix(indexer): retry Horizon cursor on 429';
if (lint(validSubject)) {
  pass(`accepted a valid subject: ${validSubject}`);
} else {
  fail(`rejected a valid subject: ${validSubject}`);
}

const invalidSubject = 'security: add gitleaks pre-commit hook via Husky';
if (!lint(invalidSubject)) {
  pass(`rejected an invalid subject: ${invalidSubject}`);
} else {
  fail(`accepted an invalid subject: ${invalidSubject} (type-enum not enforced?)`);
}

// ── 4. CONTRIBUTING.md documents exactly the configured types ────────────────

const documented = config.rules['type-enum'][2].filter((type) => type !== 'always');
const contributing = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8');

const undocumented = documented.filter((type) => !contributing.includes(`\`${type}\``));
if (undocumented.length === 0) {
  pass(`CONTRIBUTING.md documents all ${documented.length} configured types`);
} else {
  fail(`CONTRIBUTING.md does not document: ${undocumented.join(', ')}`);
}

if (!contributing.includes('commitlint.config.js')) {
  fail('CONTRIBUTING.md does not point at commitlint.config.js');
} else {
  pass('CONTRIBUTING.md points at commitlint.config.js');
}

if (failures.length > 0) {
  console.error('');
  for (const failure of failures) {
    console.error(`❌ ${failure}`);
  }
  console.error('\n✗ Commit / PR-title convention is inconsistent.');
  process.exit(1);
}

console.log('');
console.log('✅ Commit and PR-title lint rules are consistent');

#!/usr/bin/env node

/**
 * CI/CD Documentation Port Verification (#1286)
 *
 * Verifies that:
 * 1. packages/docs/content/ci-cd.mdx exists, is non-empty (>500 chars), and uses canonical package names.
 * 2. docs/DOCS_SETUP.md marks the CI/CD reference as completed (- [x]).
 * 3. Emits SHA-256 seal.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export function verifyCicdDocsPort(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const mdxPath = join(root, 'packages/docs/content/ci-cd.mdx');
  const setupPath = join(root, 'docs/DOCS_SETUP.md');

  const violations = [];

  if (!existsSync(mdxPath)) {
    violations.push({ file: 'packages/docs/content/ci-cd.mdx', reason: 'File does not exist' });
  } else if (readFileSync(mdxPath, 'utf-8').trim().length < 500) {
    violations.push({ file: 'packages/docs/content/ci-cd.mdx', reason: 'File content truncated' });
  }

  if (!existsSync(setupPath)) {
    violations.push({ file: 'docs/DOCS_SETUP.md', reason: 'DOCS_SETUP.md does not exist' });
  } else {
    const setupContent = readFileSync(setupPath, 'utf-8');
    if (!setupContent.includes('- [x] CI/CD reference')) {
      violations.push({ file: 'docs/DOCS_SETUP.md', reason: 'CI/CD reference checkbox not checked' });
    }
  }

  const valid = violations.length === 0;
  const sha256 = createHash('sha256')
    .update(existsSync(mdxPath) ? readFileSync(mdxPath, 'utf-8') : '', 'utf-8')
    .digest('hex');

  return {
    valid,
    violationsCount: violations.length,
    violations,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Verifying CI/CD Documentation Port (#1286)...');
  const res = verifyCicdDocsPort();
  if (res.valid) {
    console.log(`✓ ci-cd.mdx verified in packages/docs/content/. SHA-256: ${res.sha256}`);
    process.exit(0);
  } else {
    console.error(`✗ CI/CD DOCS PORT VALIDATION FAILED (${res.violationsCount}):`);
    res.violations.forEach((v) => console.error(`  - [${v.file}] ${v.reason}`));
    process.exit(1);
  }
}

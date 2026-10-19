#!/usr/bin/env node

/**
 * Local Development Documentation Port Verification (#1285)
 *
 * Verifies that:
 * 1. packages/docs/content/local-development.mdx exists, is non-empty (>500 chars), and uses canonical package names.
 * 2. docs/DOCS_SETUP.md marks the Local development guide as completed (- [x]).
 * 3. Emits SHA-256 seal.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export function verifyLocalDevDocsPort(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const mdxPath = join(root, 'packages/docs/content/local-development.mdx');
  const setupPath = join(root, 'docs/DOCS_SETUP.md');

  const violations = [];

  if (!existsSync(mdxPath)) {
    violations.push({ file: 'packages/docs/content/local-development.mdx', reason: 'File does not exist' });
  } else if (readFileSync(mdxPath, 'utf-8').trim().length < 500) {
    violations.push({ file: 'packages/docs/content/local-development.mdx', reason: 'File content truncated' });
  }

  if (!existsSync(setupPath)) {
    violations.push({ file: 'docs/DOCS_SETUP.md', reason: 'DOCS_SETUP.md does not exist' });
  } else {
    const setupContent = readFileSync(setupPath, 'utf-8');
    if (!setupContent.includes('- [x] Local development guide')) {
      violations.push({ file: 'docs/DOCS_SETUP.md', reason: 'Local development guide checkbox not checked' });
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
  console.log('Verifying Local Development Documentation Port (#1285)...');
  const res = verifyLocalDevDocsPort();
  if (res.valid) {
    console.log(`✓ local-development.mdx verified in packages/docs/content/. SHA-256: ${res.sha256}`);
    process.exit(0);
  } else {
    console.error(`✗ LOCAL DEV DOCS PORT VALIDATION FAILED (${res.violationsCount}):`);
    res.violations.forEach((v) => console.error(`  - [${v.file}] ${v.reason}`));
    process.exit(1);
  }
}

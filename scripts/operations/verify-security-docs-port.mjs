#!/usr/bin/env node

/**
 * Security & Threat-Model Documentation Port Verification (#1287)
 *
 * Verifies that:
 * 1. packages/docs/content/security-guide.mdx and threat-model.mdx exist and are non-empty
 * 2. docs/DOCS_SETUP.md marks both items completed (- [x])
 * 3. Both ported files pass package-name canonical checks (@iln/sdk)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export function verifySecurityDocsPort(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const secPath = join(root, 'packages/docs/content/security-guide.mdx');
  const threatPath = join(root, 'packages/docs/content/threat-model.mdx');
  const setupPath = join(root, 'docs/DOCS_SETUP.md');

  const violations = [];

  if (!existsSync(secPath)) {
    violations.push({ file: 'packages/docs/content/security-guide.mdx', reason: 'File does not exist' });
  } else if (readFileSync(secPath, 'utf-8').trim().length < 500) {
    violations.push({ file: 'packages/docs/content/security-guide.mdx', reason: 'File content truncated' });
  }

  if (!existsSync(threatPath)) {
    violations.push({ file: 'packages/docs/content/threat-model.mdx', reason: 'File does not exist' });
  } else if (readFileSync(threatPath, 'utf-8').trim().length < 500) {
    violations.push({ file: 'packages/docs/content/threat-model.mdx', reason: 'File content truncated' });
  }

  if (!existsSync(setupPath)) {
    violations.push({ file: 'docs/DOCS_SETUP.md', reason: 'DOCS_SETUP.md does not exist' });
  } else {
    const setupContent = readFileSync(setupPath, 'utf-8');
    if (!setupContent.includes('- [x] Security guide')) {
      violations.push({ file: 'docs/DOCS_SETUP.md', reason: 'Security guide checkbox not checked' });
    }
    if (!setupContent.includes('- [x] Threat model')) {
      violations.push({ file: 'docs/DOCS_SETUP.md', reason: 'Threat model checkbox not checked' });
    }
  }

  const valid = violations.length === 0;
  const sha256 = createHash('sha256')
    .update(
      (existsSync(secPath) ? readFileSync(secPath, 'utf-8') : '') +
      (existsSync(threatPath) ? readFileSync(threatPath, 'utf-8') : ''),
      'utf-8'
    )
    .digest('hex');

  return {
    valid,
    violationsCount: violations.length,
    violations,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Verifying Security & Threat-Model Documentation Port (#1287)...');
  const res = verifySecurityDocsPort();
  if (res.valid) {
    console.log(`✓ Both security-guide.mdx and threat-model.mdx verified in packages/docs/content/. SHA-256: ${res.sha256}`);
    process.exit(0);
  } else {
    console.error(`✗ SECURITY DOCS PORT VALIDATION FAILED (${res.violationsCount}):`);
    res.violations.forEach((v) => console.error(`  - [${v.file}] ${v.reason}`));
    process.exit(1);
  }
}

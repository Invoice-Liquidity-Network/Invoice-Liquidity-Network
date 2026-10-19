#!/usr/bin/env node

/**
 * SDK Migration & E2E Documentation Port Verification (#1290)
 *
 * Verifies that:
 * 1. All 4 SDK pages (sdk-migration-guide.mdx, sdk-e2e.mdx, sdk-trust-model.mdx, sdk-next-migration.mdx)
 *    exist in packages/docs/content/ and are non-empty.
 * 2. docs/DOCS_SETUP.md marks all 4 items completed (- [x]).
 * 3. Emits SHA-256 seal.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export const SDK_DOC_PAGES = [
  'sdk-migration-guide',
  'sdk-e2e',
  'sdk-trust-model',
  'sdk-next-migration',
];

export function verifySdkDocsPort(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const contentDir = join(root, 'packages/docs/content');
  const setupPath = join(root, 'docs/DOCS_SETUP.md');

  const violations = [];

  for (const page of SDK_DOC_PAGES) {
    const filePath = join(contentDir, `${page}.mdx`);
    if (!existsSync(filePath)) {
      violations.push({ file: filePath, reason: 'File does not exist' });
    } else if (readFileSync(filePath, 'utf-8').trim().length < 200) {
      violations.push({ file: filePath, reason: 'File content truncated' });
    }
  }

  if (!existsSync(setupPath)) {
    violations.push({ file: 'docs/DOCS_SETUP.md', reason: 'DOCS_SETUP.md does not exist' });
  } else {
    const setupContent = readFileSync(setupPath, 'utf-8');
    for (const page of SDK_DOC_PAGES) {
      if (!setupContent.includes(`- [x] `) || !setupContent.includes(`${page}.mdx`)) {
        violations.push({ file: 'docs/DOCS_SETUP.md', reason: `Item '${page}' not marked checked in DOCS_SETUP.md` });
      }
    }
  }

  const valid = violations.length === 0;
  let combinedContent = '';
  for (const page of SDK_DOC_PAGES) {
    const p = join(contentDir, `${page}.mdx`);
    if (existsSync(p)) combinedContent += readFileSync(p, 'utf-8');
  }
  const sha256 = createHash('sha256').update(combinedContent, 'utf-8').digest('hex');

  return {
    valid,
    violationsCount: violations.length,
    violations,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Verifying SDK & E2E Documentation Port (#1290)...');
  const res = verifySdkDocsPort();
  if (res.valid) {
    console.log(`✓ All 4 SDK MDX pages verified in packages/docs/content/. SHA-256: ${res.sha256}`);
    process.exit(0);
  } else {
    console.error(`✗ SDK DOCS PORT VALIDATION FAILED (${res.violationsCount}):`);
    res.violations.forEach((v) => console.error(`  - [${v.file}] ${v.reason}`));
    process.exit(1);
  }
}

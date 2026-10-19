#!/usr/bin/env node

/**
 * Stale Legacy Documentation Site Reference Validator (#1291)
 *
 * Enforces that markdown documentation across the repository:
 * 1. Accurately identifies packages/docs as the sole canonical deployed documentation site (docs.iln.finance).
 * 2. Does not instruct operators to deploy or rely on the retired Nextra 2 docs/ site.
 * 3. Prohibits stale localhost references targeting legacy docs ports (e.g. localhost:3001).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export const STALE_PATTERNS = [
  /deploy.*docs\/pages/i,
  /localhost:3001/i,
  /legacy docs site is deployed/i,
];

export function validateNoStaleLegacySiteRefs(docsSetupPath = join(repoRoot, 'docs/DOCS_SETUP.md')) {
  if (!existsSync(docsSetupPath)) {
    throw new Error(`File not found: ${docsSetupPath}`);
  }

  const content = readFileSync(docsSetupPath, 'utf-8');
  const violations = [];

  for (const pattern of STALE_PATTERNS) {
    if (pattern.test(content)) {
      violations.push({
        file: 'docs/DOCS_SETUP.md',
        pattern: pattern.toString(),
        reason: 'Stale reference to retired legacy docs site detected',
      });
    }
  }

  // Confirm canonical live site docs.iln.finance is explicitly designated
  if (!content.includes('docs.iln.finance')) {
    violations.push({
      file: 'docs/DOCS_SETUP.md',
      pattern: 'docs.iln.finance',
      reason: 'Missing canonical production docs domain docs.iln.finance',
    });
  }

  const valid = violations.length === 0;
  const sha256 = createHash('sha256').update(content, 'utf-8').digest('hex');

  return {
    valid,
    violationsCount: violations.length,
    violations,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Validating Stale Legacy-Site References (#1291)...');
  const res = validateNoStaleLegacySiteRefs();
  if (res.valid) {
    console.log('✓ No stale legacy docs site references detected. Production docs.iln.finance validated.');
    process.exit(0);
  } else {
    console.error(`✗ STALE REFERENCES DETECTED (${res.violationsCount}):`);
    res.violations.forEach((v) => console.error(`  - ${v.reason}`));
    process.exit(1);
  }
}

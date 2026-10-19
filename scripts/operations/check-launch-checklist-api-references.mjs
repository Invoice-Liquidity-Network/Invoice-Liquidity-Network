#!/usr/bin/env node

/**
 * Mainnet Launch Checklist API References Validator (#1295)
 *
 * Verifies that all API and package references in docs/mainnet-launch-checklist.md
 * and related API reference documentation:
 * 1. Do not use deprecated legacy prefixes (@invoice-liquidity/*)
 * 2. Use canonical @iln/* packages (@iln/sdk, @iln/sdk-next, @iln/cli)
 * 3. Link to valid canonical API documentation surfaces
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export const FORBIDDEN_LEGACY_PATTERNS = [
  /@invoice-liquidity\/sdk/,
  /@invoice-liquidity\/cli/,
  /@invoice-liquidity\/contracts/,
  /horizon-testnet\.stellar\.org\/v0/,
];

export function validateChecklistApiReferences(
  checklistPath = join(repoRoot, 'docs/mainnet-launch-checklist.md'),
  apiRefPath = join(repoRoot, 'docs/sdk-api-reference.md')
) {
  if (!existsSync(checklistPath)) {
    throw new Error(`Checklist file not found: ${checklistPath}`);
  }
  if (!existsSync(apiRefPath)) {
    throw new Error(`API reference file not found: ${apiRefPath}`);
  }

  const checklistContent = readFileSync(checklistPath, 'utf-8');
  const apiRefContent = readFileSync(apiRefPath, 'utf-8');

  const violations = [];

  // Check checklist for forbidden legacy patterns
  for (const pattern of FORBIDDEN_LEGACY_PATTERNS) {
    if (pattern.test(checklistContent)) {
      violations.push({
        file: 'docs/mainnet-launch-checklist.md',
        pattern: pattern.toString(),
        reason: 'Legacy API or package prefix detected in mainnet launch checklist',
      });
    }
    if (pattern.test(apiRefContent)) {
      violations.push({
        file: 'docs/sdk-api-reference.md',
        pattern: pattern.toString(),
        reason: 'Legacy API or package prefix detected in SDK API reference',
      });
    }
  }

  // Ensure canonical @iln packages are referenced
  const hasCanonicalSdk = checklistContent.includes('@iln/sdk') || apiRefContent.includes('@iln/sdk');
  const hasCanonicalCli = checklistContent.includes('@iln/cli') || apiRefContent.includes('@iln/cli');

  if (!hasCanonicalSdk) {
    violations.push({
      file: 'docs/sdk-api-reference.md',
      pattern: '@iln/sdk',
      reason: 'Missing canonical @iln/sdk package reference',
    });
  }
  if (!hasCanonicalCli) {
    violations.push({
      file: 'docs/sdk-api-reference.md',
      pattern: '@iln/cli',
      reason: 'Missing canonical @iln/cli package reference',
    });
  }

  const valid = violations.length === 0;
  const sha256 = createHash('sha256')
    .update(checklistContent + apiRefContent, 'utf-8')
    .digest('hex');

  return {
    valid,
    violationsCount: violations.length,
    violations,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Validating Mainnet Launch Checklist API References (#1295)...');
  const res = validateChecklistApiReferences();
  if (res.valid) {
    console.log('✓ All API references in launch checklist and SDK docs are canonical (@iln/*).');
    process.exit(0);
  } else {
    console.error(`✗ LEGACY API REFERENCES DETECTED (${res.violationsCount}):`);
    res.violations.forEach((v) => {
      console.error(`  - [${v.file}] ${v.pattern}: ${v.reason}`);
    });
    process.exit(1);
  }
}

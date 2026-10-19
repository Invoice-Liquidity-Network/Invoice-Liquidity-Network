#!/usr/bin/env node

/**
 * Investor Liquidity Disclosures Validator (#1314)
 *
 * Verifies that the investor-facing liquidity disclosures document exists,
 * is complete, and satisfies all required disclosure criteria:
 * - Capital lockup invariant
 * - Treasury first-loss scope (credit protection != liquidity)
 * - Stressed liquidity queue semantics
 * - Contract capability matrix
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export const REQUIRED_DISCLOSURE_SECTIONS = [
  'Capital Lockup Invariant',
  'Treasury First-Loss Provision Disclosures',
  'Stressed Liquidity & Redemption Queue Semantics',
  'Contract Capability Matrix',
];

export const REQUIRED_DISCLOSURE_TERMS = [
  'Non-Redeemable Committed Principal',
  'Not a Liquidity Reserve',
  'Repayment-Driven Fulfillment',
  'Instant Locked Capital Cashout',
];

export function validateLiquidityDisclosures(docPath = join(repoRoot, 'docs/investor-liquidity-disclosures.md')) {
  if (!existsSync(docPath)) {
    throw new Error(`Liquidity disclosures document not found: ${docPath}`);
  }

  const content = readFileSync(docPath, 'utf-8');
  const errors = [];

  for (const sec of REQUIRED_DISCLOSURE_SECTIONS) {
    if (!content.includes(sec)) {
      errors.push(`Missing required disclosure section: ${sec}`);
    }
  }

  for (const term of REQUIRED_DISCLOSURE_TERMS) {
    if (!content.includes(term)) {
      errors.push(`Missing required explicit disclosure term: ${term}`);
    }
  }

  const sha256 = createHash('sha256').update(content, 'utf-8').digest('hex');

  return {
    valid: errors.length === 0,
    errors,
    docPath,
    sectionsVerified: REQUIRED_DISCLOSURE_SECTIONS.length,
    termsVerified: REQUIRED_DISCLOSURE_TERMS.length,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Validating Investor-Facing Liquidity Disclosures (#1314)...');
  const result = validateLiquidityDisclosures();
  if (result.valid) {
    console.log('✓ Investor liquidity disclosures are complete and verified.');
    console.log(`  - ${result.sectionsVerified} sections verified.`);
    console.log(`  - ${result.termsVerified} explicit disclosure terms asserted.`);
    console.log(`  - SHA-256 Digest: ${result.sha256}`);
    process.exit(0);
  } else {
    console.error(`✗ Validation failed with ${result.errors.length} error(s):`);
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
}

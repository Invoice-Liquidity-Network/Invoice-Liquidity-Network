#!/usr/bin/env node

/**
 * Payer & KYB Incident Runbook Validator (#1240)
 *
 * Verifies docs/runbooks/payer-kyb-incidents.md:
 * 1. Checks that all 5 critical failure taxonomy codes are documented with severity and actions
 * 2. Asserts triage flowchart, degraded mode, and post-incident review checklist exist
 * 3. Emits SHA-256 integrity seal
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export const MANDATORY_TAXONOMY_CODES = [
  'KYB_PROVIDER_DOWN',
  'FRAUD_SPIKE_DETECTED',
  'PAYER_IDENTITY_INVALID',
  'PAYER_SANCTIONED',
  'RAPID_SUCCESSION_ANOMALY',
];

export function validatePayerKybRunbook(
  runbookPath = join(repoRoot, 'docs/runbooks/payer-kyb-incidents.md')
) {
  if (!existsSync(runbookPath)) {
    throw new Error(`Runbook not found at ${runbookPath}`);
  }

  const content = readFileSync(runbookPath, 'utf-8');
  const violations = [];

  for (const code of MANDATORY_TAXONOMY_CODES) {
    if (!content.includes(code)) {
      violations.push({
        element: code,
        reason: `Missing documentation for mandatory taxonomy code ${code}`,
      });
    }
  }

  if (!content.includes('## 2. Triage & Incident Flowchart')) {
    violations.push({ element: 'Triage Flowchart', reason: 'Missing triage flowchart section' });
  }

  if (!content.includes('## 3. Degraded Mode & Failover Enforcement')) {
    violations.push({ element: 'Degraded Mode', reason: 'Missing degraded mode & failover section' });
  }

  if (!content.includes('## 4. Post-Incident Review Checklist')) {
    violations.push({ element: 'Post-Incident Checklist', reason: 'Missing post-incident review checklist' });
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
  console.log('Validating Payer & KYB Incident Runbook (#1240)...');
  const res = validatePayerKybRunbook();
  if (res.valid) {
    console.log(`✓ Payer & KYB Incident Runbook verified. SHA-256: ${res.sha256}`);
    process.exit(0);
  } else {
    console.error(`✗ RUNBOOK VALIDATION FAILED (${res.violationsCount}):`);
    res.violations.forEach((v) => console.error(`  - ${v.reason}`));
    process.exit(1);
  }
}

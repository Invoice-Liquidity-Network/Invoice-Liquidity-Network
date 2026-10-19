#!/usr/bin/env node

/**
 * Cross-Repository Incident Ownership Matrix Validator (#1320)
 *
 * Enforces machine-checkable ownership across all three ILN repositories:
 * - Invoice-Liquidity-Network
 * - ILN-Smart-Contract
 * - ILN-Frontend
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export const REQUIRED_REPOSITORIES = [
  'Invoice-Liquidity-Network',
  'ILN-Smart-Contract',
  'ILN-Frontend',
];

export function validateCrossRepoOwnership(manifestPath = join(repoRoot, 'tests/operations/cross-repo-ownership.json')) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Ownership manifest not found at ${manifestPath}`);
  }

  const raw = readFileSync(manifestPath, 'utf-8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON manifest: ${err.message}`);
  }

  const errors = [];

  if (json.control !== 'cross-repository-incident-ownership') {
    errors.push(`Invalid control name: expected 'cross-repository-incident-ownership', got '${json.control}'`);
  }

  const repos = Array.isArray(json.repositories) ? json.repositories : [];
  const repoIds = new Set(repos.map((r) => r.id));

  for (const req of REQUIRED_REPOSITORIES) {
    if (!repoIds.has(req)) {
      errors.push(`Missing required repository in ownership manifest: ${req}`);
    }
  }

  const domains = Array.isArray(json.failure_domains) ? json.failure_domains : [];
  if (domains.length < 5) {
    errors.push(`Insufficient failure domains: expected at least 5, got ${domains.length}`);
  }

  domains.forEach((d, idx) => {
    if (!d.domain || !d.primary_repo || !d.primary_owner || !d.escalation_owner) {
      errors.push(`Failure domain #${idx} has missing ownership fields`);
    }
    if (typeof d.sla_minutes !== 'number' || d.sla_minutes <= 0) {
      errors.push(`Failure domain #${idx} ('${d.domain}') has invalid SLA: ${d.sla_minutes}`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    repoCount: repos.length,
    domainCount: domains.length,
    manifestPath,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Validating Cross-Repository Incident Ownership Matrix (#1320)...');
  const result = validateCrossRepoOwnership();
  if (result.valid) {
    console.log(`✓ Ownership matrix is valid across ${result.repoCount} repositories and ${result.domainCount} failure domains.`);
    process.exit(0);
  } else {
    console.error(`✗ Ownership matrix validation failed with ${result.errors.length} error(s):`);
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
}

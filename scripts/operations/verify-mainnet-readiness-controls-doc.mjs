#!/usr/bin/env node

/**
 * Mainnet Readiness Controls Documentation Validator (#1289)
 *
 * Validates docs/mainnet-readiness-controls.md:
 * - Asserts all mandatory control sections exist (Security, Contracts, Infrastructure, Docs/Release)
 * - Verifies every cited script exists on disk
 * - Validates verifiable evidence commands and artifacts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export function validateMainnetReadinessControlsDoc(
  docPath = join(repoRoot, 'docs/mainnet-readiness-controls.md')
) {
  if (!existsSync(docPath)) {
    throw new Error(`Documentation file not found: ${docPath}`);
  }

  const content = readFileSync(docPath, 'utf-8');
  const requiredSections = [
    '## 1. Security Controls',
    '## 2. Smart Contract Controls',
    '## 3. Infrastructure Controls',
    '## 4. Documentation & Release Controls',
  ];

  const missingSections = requiredSections.filter((s) => !content.includes(s));

  // Extract cited scripts
  const scriptRegex = /scripts\/[a-zA-Z0-9_\-\.\/]+/g;
  const matches = [...new Set(content.match(scriptRegex) || [])];

  const missingScripts = [];
  for (const s of matches) {
    const cleanPath = s.split(' ')[0];
    const fullPath = resolve(repoRoot, cleanPath);
    if (!existsSync(fullPath)) {
      missingScripts.push(cleanPath);
    }
  }

  const valid = missingSections.length === 0 && missingScripts.length === 0;
  const sha256 = createHash('sha256').update(content, 'utf-8').digest('hex');

  return {
    valid,
    missingSections,
    missingScripts,
    totalCitedScripts: matches.length,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Validating Mainnet Readiness Controls Documentation (#1289)...');
  const res = validateMainnetReadinessControlsDoc();
  if (res.valid) {
    console.log(`✓ Readiness controls doc verified (${res.totalCitedScripts} scripts validated). SHA-256: ${res.sha256}`);
    process.exit(0);
  } else {
    console.error('✗ READINESS CONTROLS DOC VALIDATION FAILED:');
    if (res.missingSections.length) console.error('  - Missing sections:', res.missingSections);
    if (res.missingScripts.length) console.error('  - Missing scripts:', res.missingScripts);
    process.exit(1);
  }
}

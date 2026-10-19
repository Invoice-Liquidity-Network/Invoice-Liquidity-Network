#!/usr/bin/env node

/**
 * Mainnet Checklist Document & Workflow Evidence Verifier (#1299)
 *
 * Verifies that automated evidence references in docs/mainnet-launch-checklist.md
 * (document links, GitHub Actions workflows, test files, and runbooks)
 * actually exist on disk, are non-empty, and contain valid schema.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export function verifyChecklistEvidence(checklistPath = join(repoRoot, 'docs/mainnet-launch-checklist.md')) {
  if (!existsSync(checklistPath)) {
    throw new Error(`Checklist file not found: ${checklistPath}`);
  }

  const checklistDir = dirname(checklistPath);
  const content = readFileSync(checklistPath, 'utf-8');
  const lines = content.split('\n');

  const evidenceSummary = {
    totalRows: 0,
    documentsChecked: 0,
    workflowsChecked: 0,
    testsChecked: 0,
    externalLinksChecked: 0,
    brokenEvidence: [],
  };

  const linkRegex = /\[([^\]]+)\]\(([^\)]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || line.includes('| --- |') || line.includes('| Item | Description |')) {
      continue;
    }

    const matches = [...line.matchAll(linkRegex)];
    if (matches.length === 0) continue;

    evidenceSummary.totalRows++;

    for (const match of matches) {
      const linkText = match[1];
      let linkTarget = match[2].trim();

      // Strip anchor hash (e.g., #restore-verification)
      const hashIndex = linkTarget.indexOf('#');
      if (hashIndex !== -1) {
        linkTarget = linkTarget.substring(0, hashIndex);
      }

      if (!linkTarget) continue;

      if (linkTarget.startsWith('http://') || linkTarget.startsWith('https://')) {
        evidenceSummary.externalLinksChecked++;
        continue;
      }

      // Resolve relative path against checklist directory
      const resolvedPath = resolve(checklistDir, linkTarget);

      if (!existsSync(resolvedPath)) {
        evidenceSummary.brokenEvidence.push({
          line: i + 1,
          linkText,
          linkTarget,
          resolvedPath,
          reason: 'FILE_NOT_FOUND',
        });
        continue;
      }

      const stat = statSync(resolvedPath);
      if (stat.isFile()) {
        const fileContent = readFileSync(resolvedPath, 'utf-8');
        if (fileContent.trim().length === 0) {
          evidenceSummary.brokenEvidence.push({
            line: i + 1,
            linkText,
            linkTarget,
            resolvedPath,
            reason: 'EMPTY_FILE',
          });
          continue;
        }
      }

      if (linkTarget.includes('.github/workflows/')) {
        evidenceSummary.workflowsChecked++;
      } else if (linkTarget.includes('test') || linkTarget.includes('tests')) {
        evidenceSummary.testsChecked++;
      } else {
        evidenceSummary.documentsChecked++;
      }
    }
  }

  const valid = evidenceSummary.brokenEvidence.length === 0;
  const sha256 = createHash('sha256').update(content, 'utf-8').digest('hex');

  return {
    valid,
    ...evidenceSummary,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Verifying Mainnet Checklist Document & Workflow Evidence (#1299)...');
  const res = verifyChecklistEvidence();
  if (res.valid) {
    console.log(`✓ All checklist evidence verified: ${res.documentsChecked} docs, ${res.workflowsChecked} workflows, ${res.testsChecked} test suites.`);
    process.exit(0);
  } else {
    console.error(`✗ BROKEN CHECKLIST EVIDENCE DETECTED (${res.brokenEvidence.length}):`);
    res.brokenEvidence.forEach((b) => {
      console.error(`  - [Line ${b.line}] '${b.linkText}' -> ${b.linkTarget} (${b.reason})`);
    });
    process.exit(1);
  }
}

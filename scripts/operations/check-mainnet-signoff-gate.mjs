#!/usr/bin/env node

/**
 * Mainnet Sign-Off Incomplete Checklist Gate (#1301)
 *
 * Prevents maintainers and CI from signing off on mainnet launch readiness
 * if ANY checklist item across Security, Contracts, Infrastructure, or Documentation
 * remains incomplete (Pending / In Progress / Open).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export function validateMainnetSignOff(checklistPath = join(repoRoot, 'docs/mainnet-launch-checklist.md')) {
  if (!existsSync(checklistPath)) {
    throw new Error(`Checklist file not found: ${checklistPath}`);
  }

  const content = readFileSync(checklistPath, 'utf-8');
  const lines = content.split('\n');

  // Check if final sign-off is checked
  const isFinalSignedOff = lines.some((l) =>
    l.includes('- [x] **Final Org-Level Sign-off**') ||
    l.includes('- [x] Final Org-Level Sign-off')
  );

  const tableRows = [];
  const incompleteItems = [];
  let currentTableHeaders = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) {
      currentTableHeaders = null;
      continue;
    }

    if (line.includes('| --- |')) {
      continue;
    }

    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);

    // Header detection
    if (cells.includes('Item') && cells.includes('Status')) {
      currentTableHeaders = cells;
      continue;
    }

    // Process rows of checklist tables
    if (currentTableHeaders && currentTableHeaders.includes('Status')) {
      const itemIdx = currentTableHeaders.indexOf('Item');
      const ownerIdx = currentTableHeaders.indexOf('Owner');
      const statusIdx = currentTableHeaders.indexOf('Status');
      const linkIdx = currentTableHeaders.indexOf('Link');

      const item = cells[itemIdx] ?? '';
      const owner = cells[ownerIdx] ?? '';
      const status = cells[statusIdx] ?? '';
      const link = linkIdx !== -1 ? (cells[linkIdx] ?? '') : '';

      tableRows.push({ item, owner, status, link });

      if (status.toLowerCase() !== 'done' && !status.toLowerCase().includes('waived')) {
        incompleteItems.push({ item, owner, status, link });
      }
    }
  }

  const valid = !isFinalSignedOff || incompleteItems.length === 0;

  const sha256 = createHash('sha256').update(content, 'utf-8').digest('hex');

  return {
    valid,
    isFinalSignedOff,
    totalTableItems: tableRows.length,
    incompleteCount: incompleteItems.length,
    incompleteItems,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Validating Mainnet Launch Sign-Off Gate (#1301)...');
  const res = validateMainnetSignOff();
  if (res.valid) {
    console.log(`✓ Mainnet sign-off gate passed. (Total items: ${res.totalTableItems}, Incomplete: ${res.incompleteCount}, SignedOff: ${res.isFinalSignedOff})`);
    process.exit(0);
  } else {
    console.error(`✗ PREMATURE SIGN-OFF DETECTED: Final Org-Level Sign-off is checked, but ${res.incompleteCount} item(s) remain incomplete:`);
    res.incompleteItems.forEach((it) => {
      console.error(`  - [${it.status}] ${it.item} (Owner: ${it.owner})`);
    });
    process.exit(1);
  }
}

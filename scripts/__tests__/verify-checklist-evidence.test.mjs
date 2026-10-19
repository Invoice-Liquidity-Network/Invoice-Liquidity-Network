import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyChecklistEvidence } from '../operations/verify-checklist-evidence.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Checklist Document & Workflow Evidence Verification Suite (#1299)', () => {
  it('scans canonical mainnet checklist and validates evidence references', () => {
    const res = verifyChecklistEvidence();
    assert.equal(res.valid, true);
    assert.equal(res.brokenEvidence.length, 0);
    assert.ok(res.documentsChecked > 0);
    assert.ok(res.workflowsChecked > 0);
    assert.ok(res.totalRows > 0);
    assert.ok(res.sha256.length === 64);
  });

  it('fails closed when a checklist link targets a non-existent file', () => {
    const tempFile = join(__dirname, 'mock-broken-checklist.md');
    const mockContent = `
## Security
| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Missing Spec | A non-existent file | Sec lead | Done | [Broken Link](./does-not-exist.md) |
`;
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = verifyChecklistEvidence(tempFile);
      assert.equal(res.valid, false);
      assert.equal(res.brokenEvidence.length, 1);
      assert.equal(res.brokenEvidence[0].reason, 'FILE_NOT_FOUND');
    } finally {
      unlinkSync(tempFile);
    }
  });
});

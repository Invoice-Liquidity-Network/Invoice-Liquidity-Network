import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateChecklistFreshnessAndMetadata } from '../operations/check-checklist-freshness-metadata.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Checklist Freshness & Owner Metadata Suite (#1298)', () => {
  it('validates canonical checklist and confirms all owners and freshness pass', () => {
    const res = validateChecklistFreshnessAndMetadata();
    assert.equal(res.valid, true);
    assert.equal(res.issuesCount, 0);
    assert.ok(res.totalItems > 10);
    assert.equal(res.isFresh, true);
    assert.ok(res.sha256.length === 64);
  });

  it('fails closed when an item has an unrecognized owner role', () => {
    const tempFile = join(__dirname, 'mock-invalid-owner-checklist.md');
    const mockContent = `
## Security
| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Random Task | Description | Anonymous Intern | Done | [link](audit.md) |

- [x] **Final Org-Level Sign-off**
  - **Date**: August 30, 2026
`;
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = validateChecklistFreshnessAndMetadata(tempFile);
      assert.equal(res.valid, false);
      assert.equal(res.issuesCount, 1);
      assert.equal(res.metadataIssues[0].issue, 'UNRECOGNIZED_OWNER_ROLE');
    } finally {
      unlinkSync(tempFile);
    }
  });

  it('fails closed when sign-off date exceeds maxAgeDays', () => {
    const tempFile = join(__dirname, 'mock-stale-date-checklist.md');
    const mockContent = `
## Security
| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Security Review | Description | Security lead | Done | [link](audit.md) |

- [x] **Final Org-Level Sign-off**
  - **Date**: January 01, 2026
`;
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = validateChecklistFreshnessAndMetadata(tempFile, { referenceDate: '2026-08-30', maxAgeDays: 30 });
      assert.equal(res.valid, false);
      assert.equal(res.isFresh, false);
      assert.ok(res.metadataIssues.some((iss) => iss.issue === 'STALE_SIGNOFF_DATE'));
    } finally {
      unlinkSync(tempFile);
    }
  });
});

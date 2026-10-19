import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateChecklistApiReferences } from '../operations/check-launch-checklist-api-references.mjs';

describe('Launch Checklist API References Suite (#1295)', () => {
  it('validates canonical API references and confirms no legacy package prefixes remain', () => {
    const res = validateChecklistApiReferences();
    assert.equal(res.valid, true);
    assert.equal(res.violationsCount, 0);
    assert.ok(res.sha256.length === 64);
  });
});

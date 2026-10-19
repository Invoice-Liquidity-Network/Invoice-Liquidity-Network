import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCrossRepoOwnership,
  REQUIRED_REPOSITORIES,
} from '../operations/check-cross-repo-ownership.mjs';

describe('Cross-Repository Incident Ownership Suite (#1320)', () => {
  it('validates canonical cross-repo ownership manifest successfully', () => {
    const res = validateCrossRepoOwnership();
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
    assert.equal(res.repoCount, REQUIRED_REPOSITORIES.length);
    assert.ok(res.domainCount >= 5);
  });

  it('fails closed when manifest is missing or malformed', () => {
    assert.throws(
      () => validateCrossRepoOwnership('/non/existent/manifest.json'),
      /Ownership manifest not found/
    );
  });
});

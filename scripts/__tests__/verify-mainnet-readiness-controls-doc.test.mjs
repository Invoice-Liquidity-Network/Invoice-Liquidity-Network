import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMainnetReadinessControlsDoc } from '../operations/verify-mainnet-readiness-controls-doc.mjs';

describe('Mainnet Readiness Controls Documentation Suite (#1289)', () => {
  it('validates canonical docs/mainnet-readiness-controls.md and confirms all sections and scripts exist', () => {
    const res = validateMainnetReadinessControlsDoc();
    assert.equal(res.valid, true);
    assert.equal(res.missingSections.length, 0);
    assert.equal(res.missingScripts.length, 0);
    assert.ok(res.totalCitedScripts > 0);
    assert.ok(res.sha256.length === 64);
  });
});

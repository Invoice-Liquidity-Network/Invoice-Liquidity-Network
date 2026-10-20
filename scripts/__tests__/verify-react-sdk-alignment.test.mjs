import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyReactSdkAlignment } from '../operations/verify-react-sdk-alignment.mjs';

describe('React Package SDK Alignment Suite (#1221)', () => {
  it('validates canonical @iln/sdk alignment across packages/react', () => {
    const res = verifyReactSdkAlignment();
    assert.equal(res.valid, true);
    assert.equal(res.violationsCount, 0);
    assert.ok(res.sha256.length === 64);
  });
});

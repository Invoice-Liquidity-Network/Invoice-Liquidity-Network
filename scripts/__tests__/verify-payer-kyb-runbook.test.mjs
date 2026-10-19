import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePayerKybRunbook } from '../operations/verify-payer-kyb-runbook.mjs';

describe('Payer & KYB Incident Runbook Suite (#1240)', () => {
  it('validates canonical docs/runbooks/payer-kyb-incidents.md and confirms all taxonomy codes pass', () => {
    const res = validatePayerKybRunbook();
    assert.equal(res.valid, true);
    assert.equal(res.violationsCount, 0);
    assert.ok(res.sha256.length === 64);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAnchorEnforcementExercise } from '../drills/verify-anchor-enforcement-evidence.mjs';

describe('Settlement Anchor Enforcement Evidence Suite (#1308)', () => {
  it('executes end-to-end anchor failover and produces verified tamper-evident evidence bundle', () => {
    const res = runAnchorEnforcementExercise('@compliance-lead');

    assert.equal(res.success, true);
    assert.equal(res.evidenceBundle.status, 'PASS');
    assert.equal(res.evidenceBundle.metrics.registeredAnchorsCount, 2);
    assert.equal(res.evidenceBundle.metrics.circuitBreakerState, 'OPEN');
    assert.equal(res.evidenceBundle.metrics.routingPermitted, false);
    assert.ok(res.evidenceBundle.sha256.length === 64);
    assert.equal(res.verification.valid, true);
  });
});

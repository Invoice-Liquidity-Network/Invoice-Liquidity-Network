import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { KybOutageRehearsalSimulator } from '../drills/kyb-outage-rehearsal.mjs';

describe('Production KYB Outage Containment Rehearsal Suite (#1321)', () => {
  let sim;

  beforeEach(() => {
    sim = new KybOutageRehearsalSimulator();
  });

  it('fails closed with rejected-kyb-unavailable when strict KYB is required during outage', () => {
    sim.injectProviderOutage();
    const res = sim.verifyPayer('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', true);

    assert.equal(res.verified, false);
    assert.equal(res.outcome, 'rejected-kyb-unavailable');
    assert.equal(res.confidence, 0.0);
  });

  it('gracefully degrades to on-chain reputation for non-strict corridors during outage', () => {
    sim.injectProviderOutage();
    const res = sim.verifyPayer('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', false);

    assert.equal(res.verified, true);
    assert.equal(res.outcome, 'approved-onchain-reputation-fallback');
    assert.equal(res.confidence, 0.65);
  });

  it('restores full KYB verification upon executing secondary provider failover', () => {
    sim.injectProviderOutage();
    sim.executeContainmentRunbook('FAILOVER_SECONDARY');

    const res = sim.verifyPayer('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', true);
    assert.equal(res.verified, true);
    assert.equal(res.outcome, 'approved-kyb-verified');
    assert.equal(res.provider, 'trulioo-secondary-kyb');
  });

  it('runs complete rehearsal and persists cryptographically signed evidence bundle', () => {
    const outcome = sim.runFullRehearsal('@sec-commander');
    assert.equal(outcome.success, true);
    assert.ok(outcome.evidenceBundle.sha256.length === 64);
    assert.equal(outcome.evidenceBundle.status, 'PASS');
    assert.equal(outcome.evidenceBundle.retentionDays, 90);
  });
});

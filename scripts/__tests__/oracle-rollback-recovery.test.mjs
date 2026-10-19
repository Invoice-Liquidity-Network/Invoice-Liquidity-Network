import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OracleRollbackRehearsalSimulator } from '../drills/exercise-oracle-rollback-recovery.mjs';

describe('Oracle Rollback & Recovery Suite (#1315)', () => {
  it('engages emergency kill switch and forces fallback static bounds during anomaly', () => {
    const sim = new OracleRollbackRehearsalSimulator();
    sim.executeEmergencyKillSwitch();

    const res = sim.queryPayer('payer:ANY');
    assert.equal(res.status, 'FALLBACK_STATIC_BOUNDS');
    assert.equal(res.score, 50);
    assert.equal(res.verified, false);
  });

  it('purges poisoned cache and rolls back image to restore clean evaluation', () => {
    const sim = new OracleRollbackRehearsalSimulator();
    const outcome = sim.runFullRehearsal('@sec-commander');

    assert.equal(outcome.success, true);
    assert.equal(outcome.evidenceBundle.status, 'PASS');
    assert.ok(outcome.evidenceBundle.sha256.length === 64);
    assert.equal(outcome.evidenceBundle.metrics.finalScore, 25);
  });
});

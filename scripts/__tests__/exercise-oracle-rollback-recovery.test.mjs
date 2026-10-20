import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OracleRollbackRehearsalSimulator,
  runOracleRollbackDrill,
} from '../drills/exercise-oracle-rollback-recovery.mjs';

describe('Oracle Rollback and Recovery Rehearsal Suite (#1315)', () => {
  it('simulates complete rollback lifecycle: kill-switch, cache purge, digest rollback, and re-enable', () => {
    const sim = new OracleRollbackRehearsalSimulator();
    assert.equal(sim.isOracleEnabled(), true);

    // Initial state: poisoned cache returns score 98
    const q1 = sim.queryPayer('payer:FRAUDULENT_PAYER_XYZ');
    assert.equal(q1.status, 'CACHED_ORACLE_RESPONSE');
    assert.equal(q1.score, 98);

    // 1. Kill-switch
    const killRes = sim.executeEmergencyKillSwitch();
    assert.equal(killRes.success, true);
    assert.equal(sim.isOracleEnabled(), false);

    const q2 = sim.queryPayer('payer:FRAUDULENT_PAYER_XYZ');
    assert.equal(q2.status, 'FALLBACK_STATIC_BOUNDS');
    assert.equal(q2.score, 50);

    // 2. Cache purge
    const purgeRes = sim.executeCachePurge();
    assert.equal(purgeRes.success, true);

    // 3. Rollback image digest
    const rollbackRes = sim.executeImageRollback('sha256:verified-clean-pre-incident-digest-789');
    assert.equal(rollbackRes.success, true);
    assert.equal(sim.imageDigest, 'sha256:verified-clean-pre-incident-digest-789');

    // 4. Re-enable
    const restoreRes = sim.restoreOracleService();
    assert.equal(restoreRes.success, true);
    assert.equal(sim.isOracleEnabled(), true);

    // Query after rollback
    const q3 = sim.queryPayer('payer:FRAUDULENT_PAYER_XYZ');
    assert.equal(q3.status, 'FRESH_EVALUATION');
    assert.equal(q3.score, 25); // Clean baseline score
  });

  it('runs automated drill execution and saves verified cryptographic evidence bundle', () => {
    const result = runOracleRollbackDrill();
    assert.equal(result.success, true);
    assert.equal(result.evidenceBundle.status, 'PASS');
    assert.ok(result.evidenceBundle.sha256.length === 64);
  });
});

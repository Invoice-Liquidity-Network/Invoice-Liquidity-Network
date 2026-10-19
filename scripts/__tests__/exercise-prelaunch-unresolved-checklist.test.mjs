import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPrelaunchChecklistRehearsal, evaluateChecklistDeploymentGate } from '../drills/exercise-prelaunch-unresolved-checklist.mjs';

describe('Prelaunch Rehearsal for Unresolved Checklist Rows Suite (#1300)', () => {
  it('blocks deployment and identifies all unresolved checklist rows', () => {
    const rows = [
      { item: 'Audit', status: 'Done', owner: '@sec' },
      { item: 'Load test', status: 'Pending', owner: '@qa' },
    ];
    const gate = evaluateChecklistDeploymentGate(rows);
    assert.equal(gate.deploymentAuthorized, false);
    assert.equal(gate.unresolvedCount, 1);
    assert.equal(gate.unresolvedRows[0].item, 'Load test');
  });

  it('runs complete prelaunch rehearsal and outputs verified cryptographic evidence', () => {
    const res = runPrelaunchChecklistRehearsal('@release-commander');
    assert.equal(res.success, true);
    assert.equal(res.evidenceBundle.status, 'PASS');
    assert.equal(res.evidenceBundle.metrics.testedScenariosCount, 3);
    assert.equal(res.evidenceBundle.metrics.failClosedPreserved, true);
    assert.ok(res.evidenceBundle.sha256.length === 64);
    assert.equal(res.verification.valid, true);
  });
});

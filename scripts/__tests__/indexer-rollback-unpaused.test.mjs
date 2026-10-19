import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IndexerRollbackRehearsal } from '../drills/exercise-indexer-rollback-unpaused.mjs';

describe('Indexer Rollback Without Contract Pause Suite (#1316)', () => {
  it('executes indexer rewind and catchup while contract remains live and unpaused', () => {
    const drill = new IndexerRollbackRehearsal();
    assert.equal(drill.isContractLiveAndUnpaused(), true);

    const res = drill.runFullRehearsal('@infra-lead');
    assert.equal(res.rollback.contractRemainedUnpaused, true);
    assert.equal(res.rollback.purgedEvents, 30);
    assert.equal(res.rollback.cursorLedger, 1020);

    assert.equal(res.catchup.replayedEvents, 10);
    assert.equal(res.catchup.cursorLedger, 1030);

    assert.equal(res.evidenceBundle.status, 'PASS');
    assert.ok(res.evidenceBundle.sha256.length === 64);
  });

  it('fails closed and throws error if contract pause is triggered', () => {
    const drill = new IndexerRollbackRehearsal();
    drill.contractPaused = true; // Inject pause violation

    assert.throws(
      () => drill.executeRollback(1020),
      /VIOLATION: Contract pause was triggered/
    );
  });
});

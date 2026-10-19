import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseRollbackEvaluator } from '../operations/release-rollback-criteria.mjs';

describe('Release Rollback Criteria Suite (#1323)', () => {
  let evaluator;

  beforeEach(() => {
    evaluator = new ReleaseRollbackEvaluator();
  });

  it('approves SDK release when client error rate is below threshold and no breaking XDR change', () => {
    const res = evaluator.evaluateSdkRelease({
      clientErrorRatePercent: 0.2,
      breakingXdrChange: false,
    });
    assert.equal(res.shouldRollback, false);
    assert.equal(res.recommendedAction, 'PROCEED_RELEASE');
  });

  it('triggers SDK rollback when breaking XDR serialization is detected', () => {
    const res = evaluator.evaluateSdkRelease({
      clientErrorRatePercent: 0.1,
      breakingXdrChange: true,
    });
    assert.equal(res.shouldRollback, true);
    assert.equal(res.recommendedAction, 'NPM_DEPRECATE_AND_DOWNGRADE_PIN');
    assert.equal(res.triggers[0].code, 'SDK_BREAKING_XDR_MUTATION');
    assert.ok(res.recoverySteps.length > 0);
  });

  it('triggers indexer service rollback when cursor lag exceeds threshold', () => {
    const res = evaluator.evaluateServiceRelease('indexer', {
      cursorLagLedgers: 25,
      crashCount15m: 0,
    });
    assert.equal(res.shouldRollback, true);
    assert.equal(res.triggers[0].code, 'INDEXER_SYNC_LAG_EXCEEDED');
  });

  it('triggers rollback when service experiences crash loop backoff', () => {
    const res = evaluator.evaluateServiceRelease('notifications', {
      deliveryFailureRatePercent: 0.5,
      crashCount15m: 4,
    });
    assert.equal(res.shouldRollback, true);
    assert.equal(res.triggers[0].code, 'SERVICE_CRASH_LOOP_DETECTED');
  });
});

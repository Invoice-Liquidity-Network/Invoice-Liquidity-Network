import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SettlementAnchorPolicyEngine,
  ANCHOR_HEALTH_STATUS,
} from '../operations/settlement-anchor-policy.mjs';

describe('Settlement Anchor Freshness & Failure Policy Suite (#1309)', () => {
  const engine = new SettlementAnchorPolicyEngine();

  it('enforces corridor redundancy invariant requiring >= 2 independent anchors', () => {
    assert.throws(
      () => engine.registerCorridor('SINGLE-ANCHOR-CORRIDOR', ['only-one-anchor']),
      /INSUFFICIENT_ANCHOR_REDUNDANCY/
    );

    const validCorridor = engine.registerCorridor('DUAL-ANCHOR-CORRIDOR', ['anchor-a', 'anchor-b']);
    assert.equal(validCorridor.anchorCount, 2);
    assert.equal(validCorridor.primaryAnchor, 'anchor-a');
  });

  it('validates quote freshness rejecting timestamps older than 300s', () => {
    const fresh = engine.isQuoteFresh(Date.now() - 50_000); // 50s old
    assert.equal(fresh.isFresh, true);

    const stale = engine.isQuoteFresh(Date.now() - 350_000); // 350s old
    assert.equal(stale.isFresh, false);
  });

  it('escalates degraded status when error rate exceeds 5%', () => {
    const health = engine.evaluateAnchorHealth({ errorRate15m: 0.08 });
    assert.equal(health.status, ANCHOR_HEALTH_STATUS.DEGRADED);
    assert.equal(health.action, 'ROUTE_TO_SECONDARY_FALLBACK');
    assert.equal(health.routingPermitted, true);
  });

  it('suspends anchor corridor when consecutive failures reach threshold', () => {
    const health = engine.evaluateAnchorHealth({ consecutiveFailures: 5 });
    assert.equal(health.status, ANCHOR_HEALTH_STATUS.SUSPENDED);
    assert.equal(health.action, 'TRIP_CIRCUIT_BREAKER_FAILOVER');
    assert.equal(health.routingPermitted, false);
  });
});

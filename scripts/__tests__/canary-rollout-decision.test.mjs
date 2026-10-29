import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../canary/rollout-decision.mjs';
import { getPolicy, CANARY_POLICIES } from '../canary/policy.mjs';

const INDEXER_POLICY = getPolicy('indexer');
const HEALTHY_SAMPLE = { errorRatio: 0, latencyP95Seconds: 0.05 };

describe('getPolicy', () => {
  it('returns a policy for each of the three canary services from issue #1095', () => {
    for (const service of ['indexer', 'oracle-service', 'notifications']) {
      const policy = getPolicy(service);
      assert.ok(policy.bakeMinutes > 0);
      assert.ok(policy.maxErrorRatio > 0);
      assert.ok(policy.maxLatencyP95Seconds > 0);
    }
  });

  it('throws on an unknown service', () => {
    assert.throws(() => getPolicy('frontend'));
  });

  it('matches the fast-burn thresholds already defined in monitoring/prometheus/slo-alerts.yml', () => {
    assert.equal(CANARY_POLICIES.indexer.maxErrorRatio, 0.001 * 14);
    assert.equal(CANARY_POLICIES['oracle-service'].maxErrorRatio, 0.005 * 6);
    assert.equal(CANARY_POLICIES.notifications.maxErrorRatio, 0.001 * 14);
  });
});

describe('decide', () => {
  it('holds while below the required number of clean samples', () => {
    const result = decide(INDEXER_POLICY, [HEALTHY_SAMPLE]);
    assert.equal(result.decision, 'hold');
  });

  it('promotes once enough clean samples cover the full bake window', () => {
    const samplesNeeded = Math.ceil((INDEXER_POLICY.bakeMinutes * 60) / INDEXER_POLICY.pollIntervalSeconds);
    const samples = Array.from({ length: samplesNeeded }, () => HEALTHY_SAMPLE);
    const result = decide(INDEXER_POLICY, samples);
    assert.equal(result.decision, 'promote');
  });

  it('rolls back immediately on a single error-ratio breach, even mid-bake', () => {
    const samples = [HEALTHY_SAMPLE, HEALTHY_SAMPLE, { errorRatio: 0.5, latencyP95Seconds: 0.05 }];
    const result = decide(INDEXER_POLICY, samples);
    assert.equal(result.decision, 'rollback');
    assert.equal(result.breachedAt, 2);
  });

  it('rolls back immediately on a single latency breach', () => {
    const samples = [{ errorRatio: 0, latencyP95Seconds: 999 }];
    const result = decide(INDEXER_POLICY, samples);
    assert.equal(result.decision, 'rollback');
    assert.match(result.reason, /latency/);
  });

  it('does not roll back on a breach exactly at the threshold (only above it)', () => {
    const atThreshold = { errorRatio: INDEXER_POLICY.maxErrorRatio, latencyP95Seconds: 0.05 };
    const result = decide(INDEXER_POLICY, [atThreshold]);
    assert.notEqual(result.decision, 'rollback');
  });

  it('holds with zero samples', () => {
    const result = decide(INDEXER_POLICY, []);
    assert.equal(result.decision, 'hold');
  });
});

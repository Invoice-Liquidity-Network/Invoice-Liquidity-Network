import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRollout } from '../canary/rollout.mjs';

const FAST_POLICY = {
  bakeMinutes: 3 / 60, // 3 seconds worth of bake, expressed in minutes
  pollIntervalSeconds: 1,
  maxErrorRatio: 0.01,
  maxLatencyP95Seconds: 1,
};
const noopSleep = async () => {};

function makeCalls() {
  const calls = { start: 0, promote: 0, rollback: 0, rollbackReasons: [] };
  return {
    calls,
    startFn: () => {
      calls.start++;
    },
    promoteFn: () => {
      calls.promote++;
    },
    rollbackFn: (reason) => {
      calls.rollback++;
      calls.rollbackReasons.push(reason);
    },
  };
}

describe('runRollout', () => {
  it('promotes after enough clean samples cover the bake window', async () => {
    const { calls, startFn, promoteFn, rollbackFn } = makeCalls();
    let sampleCount = 0;
    const result = await runRollout({
      policy: FAST_POLICY,
      sampleFn: async () => {
        sampleCount++;
        return { errorRatio: 0, latencyP95Seconds: 0.01 };
      },
      startFn,
      promoteFn,
      rollbackFn,
      sleepFn: noopSleep,
    });

    assert.equal(result.decision, 'promote');
    assert.equal(calls.start, 1);
    assert.equal(calls.promote, 1);
    assert.equal(calls.rollback, 0);
    assert.ok(sampleCount >= 3);
  });

  it('rolls back as soon as a sample breaches the error-ratio threshold', async () => {
    const { calls, startFn, promoteFn, rollbackFn } = makeCalls();
    let sampleCount = 0;
    const result = await runRollout({
      policy: FAST_POLICY,
      sampleFn: async () => {
        sampleCount++;
        // Regress on the 2nd sample — simulates a bad canary deploy.
        if (sampleCount === 2) return { errorRatio: 0.9, latencyP95Seconds: 0.01 };
        return { errorRatio: 0, latencyP95Seconds: 0.01 };
      },
      startFn,
      promoteFn,
      rollbackFn,
      sleepFn: noopSleep,
    });

    assert.equal(result.decision, 'rollback');
    assert.equal(calls.rollback, 1);
    assert.equal(calls.promote, 0);
    assert.equal(sampleCount, 2, 'should stop polling immediately on breach, not keep sampling');
  });

  it('rolls back as soon as a sample breaches the latency threshold', async () => {
    const { calls, startFn, promoteFn, rollbackFn } = makeCalls();
    const result = await runRollout({
      policy: FAST_POLICY,
      sampleFn: async () => ({ errorRatio: 0, latencyP95Seconds: 999 }),
      startFn,
      promoteFn,
      rollbackFn,
      sleepFn: noopSleep,
    });

    assert.equal(result.decision, 'rollback');
    assert.match(calls.rollbackReasons[0], /latency/);
  });

  it('fails safe (rolls back) if the bake window is exceeded without a decision', async () => {
    const { calls, startFn, promoteFn, rollbackFn } = makeCalls();
    // A policy whose bakeSamplesNeeded the loop can never reach because
    // maxIterations is capped below it.
    const result = await runRollout({
      policy: { ...FAST_POLICY, bakeMinutes: 10 }, // needs 600 samples
      sampleFn: async () => ({ errorRatio: 0, latencyP95Seconds: 0.01 }),
      startFn,
      promoteFn,
      rollbackFn,
      sleepFn: noopSleep,
      maxIterations: 2,
    });

    assert.equal(result.decision, 'rollback');
    assert.equal(calls.rollback, 1);
    assert.match(calls.rollbackReasons[0], /exceeded/i);
  });

  it('always calls startFn exactly once before any sampling', async () => {
    const order = [];
    await runRollout({
      policy: FAST_POLICY,
      sampleFn: async () => {
        order.push('sample');
        return { errorRatio: 0, latencyP95Seconds: 0.01 };
      },
      startFn: () => order.push('start'),
      promoteFn: () => order.push('promote'),
      rollbackFn: () => order.push('rollback'),
      sleepFn: noopSleep,
    });

    assert.equal(order[0], 'start');
    assert.ok(!order.slice(1).includes('start'));
  });
});

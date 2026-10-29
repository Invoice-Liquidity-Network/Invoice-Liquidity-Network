/**
 * scripts/canary/rollout-decision.mjs
 *
 * Pure decision engine for a canary bake window (issue #1095). Takes a
 * per-service policy (scripts/canary/policy.mjs) and a stream of samples
 * `{ errorRatio, latencyP95Seconds }` polled from the canary instance's SLI
 * recording rules, and decides `rollback` | `promote` | `hold` after each
 * sample. No I/O here — Prometheus querying and the actual
 * start/promote/rollback actions live in rollout.mjs's adapters, so this can
 * be exhaustively unit-tested (including the drill in
 * scripts/canary/rollout-drill.mjs) without a real Prometheus or deploy
 * target.
 */

/**
 * @param {object} policy - from getPolicy(service)
 * @param {Array<{errorRatio: number, latencyP95Seconds: number}>} samples - in poll order
 * @returns {{ decision: 'rollback' | 'promote' | 'hold', reason: string, breachedAt?: number }}
 */
export function decide(policy, samples) {
  for (let i = 0; i < samples.length; i++) {
    const { errorRatio, latencyP95Seconds } = samples[i];

    if (errorRatio > policy.maxErrorRatio) {
      return {
        decision: 'rollback',
        reason: `Sample ${i}: error ratio ${errorRatio} exceeds canary threshold ${policy.maxErrorRatio}.`,
        breachedAt: i,
      };
    }

    if (latencyP95Seconds > policy.maxLatencyP95Seconds) {
      return {
        decision: 'rollback',
        reason: `Sample ${i}: p95 latency ${latencyP95Seconds}s exceeds canary threshold ${policy.maxLatencyP95Seconds}s.`,
        breachedAt: i,
      };
    }
  }

  const bakeSamplesNeeded = Math.ceil((policy.bakeMinutes * 60) / policy.pollIntervalSeconds);

  if (samples.length >= bakeSamplesNeeded) {
    return {
      decision: 'promote',
      reason: `${samples.length} clean sample(s) over the ${policy.bakeMinutes}-minute bake window with no threshold breach.`,
    };
  }

  return {
    decision: 'hold',
    reason: `${samples.length}/${bakeSamplesNeeded} clean sample(s) so far; continuing to bake.`,
  };
}

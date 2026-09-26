import { describe, expect, it, vi } from 'vitest';

import {
  SOURCE_HEALTH_STATE_RANK,
  SourceHealthTracker,
  defaultSourceFailoverConfig,
  loadSourceFailoverConfig,
  withFailover,
  type PrimarySecondary,
  type SourceHealthTrackerOptions,
} from './sourceFailover';

/**
 * Source failover mechanics (issue #1051).
 *
 * Demotion is fast (one bad window moves traffic), promotion is slow
 * (consecutive successes *and* a cooldown), so the tests below pin both sides
 * of the hysteresis — the anti-flapping property lives in the gap between
 * them.
 */

const FAST = {
  ...defaultSourceFailoverConfig(),
  cooldownMs: 1_000,
  recoverySuccesses: 2,
};

function makeTracker(options: SourceHealthTrackerOptions = {}) {
  return new SourceHealthTracker({ config: FAST, ...options });
}

describe('failover config', () => {
  it('defaults match the values documented in the runbook', () => {
    expect(defaultSourceFailoverConfig()).toEqual({
      windowSize: 50,
      errorRateThreshold: 0.5,
      errorRateUnavailableThreshold: 1,
      latencyP95ThresholdMs: 1500,
      staleAfterMs: 5 * 60 * 1000,
      recoverySuccesses: 5,
      cooldownMs: 60 * 1000,
    });
  });

  it('reads env overrides and ignores garbage', () => {
    const config = loadSourceFailoverConfig({
      ORACLE_FAILOVER_WINDOW_SIZE: '10',
      ORACLE_FAILOVER_ERROR_RATE: '0.25',
      ORACLE_FAILOVER_P95_LATENCY_MS: 'oops',
      ORACLE_FAILOVER_STALE_AFTER_MS: '90000',
      ORACLE_FAILOVER_RECOVERY_SUCCESSES: '3',
      ORACLE_FAILOVER_COOLDOWN_MS: '15000',
      ORACLE_FAILOVER_ERROR_RATE_UNAVAILABLE: '0.9',
    });

    const base = defaultSourceFailoverConfig();
    expect(config).toEqual({
      windowSize: 10,
      errorRateThreshold: 0.25,
      errorRateUnavailableThreshold: 0.9,
      latencyP95ThresholdMs: base.latencyP95ThresholdMs,
      staleAfterMs: 90_000,
      recoverySuccesses: 3,
      cooldownMs: 15_000,
    });
  });

  it('ignores blank and negative env values', () => {
    const base = defaultSourceFailoverConfig();
    const config = loadSourceFailoverConfig({
      ORACLE_FAILOVER_WINDOW_SIZE: '',
      ORACLE_FAILOVER_COOLDOWN_MS: '-5',
    });

    expect(config).toEqual(base);
  });
});

describe('SourceHealthTracker state machine', () => {
  it('starts unknown sources as healthy and off cooldown', () => {
    const tracker = makeTracker();
    expect(tracker.state('never-seen', 0)).toBe('healthy');
    expect(tracker.isCoolingDown('never-seen', 0)).toBe(false);
  });

  it('demotes to unavailable when the whole window errors', () => {
    const tracker = makeTracker();
    tracker.noteAttempt('rpc', false, 5, 0);

    expect(tracker.state('rpc', 0)).toBe('unavailable');
  });

  it('demotes to degraded past the error-rate threshold', () => {
    // With unavailability out of reach, a window that merely *often* fails
    // is degraded — demotion to unavailable is reserved for total failure.
    const tracker = new SourceHealthTracker({
      config: { ...FAST, errorRateUnavailableThreshold: 1.1, recoverySuccesses: 99 },
    });
    for (let i = 0; i < 4; i += 1) tracker.noteAttempt('rpc', false, 5, i);
    tracker.noteAttempt('rpc', true, 5, 4);

    expect(tracker.state('rpc', 4)).toBe('degraded');
  });

  it('demotes to degraded when p95 latency breaches the threshold', () => {
    const tracker = makeTracker();
    tracker.noteAttempt('rpc', true, 2_000, 0);

    expect(tracker.state('rpc', 0)).toBe('degraded');
  });

  it('demotes to unavailable once the last success goes stale', () => {
    const tracker = new SourceHealthTracker({
      config: { ...FAST, staleAfterMs: 10_000 },
    });
    tracker.noteAttempt('indexer', true, 5, 1000);
    expect(tracker.state('indexer', 1000)).toBe('healthy');

    expect(tracker.state('indexer', 1000 + 10_001)).toBe('unavailable');
  });

  it('never staleness-demotes a source that has not succeeded at all yet', () => {
    // Only error-rate drives a source that has never returned data; the
    // stale-clock has nothing to measure against.
    const tracker = new SourceHealthTracker({
      config: { ...FAST, staleAfterMs: 10_000, errorRateUnavailableThreshold: 1.01 },
    });
    tracker.noteAttempt('indexer', true, 5, 0);
    // lastSuccessAtMs is 0 (recorded at clock zero) → staleness must not fire.
    expect(tracker.state('indexer', 50_000)).toBe('healthy');
  });

  it('escalates degraded to unavailable when silence goes stale', () => {
    const tracker = new SourceHealthTracker({
      config: { ...FAST, staleAfterMs: 10_000, errorRateUnavailableThreshold: 1.1 },
    });
    // p95 breach puts it in degraded, then time passing makes it unavailable.
    tracker.noteAttempt('indexer', true, 2_000, 1);
    expect(tracker.state('indexer', 1)).toBe('degraded');
    expect(tracker.state('indexer', 20_001)).toBe('unavailable');
  });

  it('requires both the success streak and the cooldown to recover', () => {
    const tracker = makeTracker();
    tracker.noteAttempt('rpc', false, 5, 0);
    expect(tracker.state('rpc', 0)).toBe('unavailable');

    // Streak not met.
    tracker.noteAttempt('rpc', true, 5, 500);
    expect(tracker.state('rpc', 500)).toBe('unavailable');

    // Streak met but cooldown not elapsed.
    tracker.noteAttempt('rpc', true, 5, 600);
    expect(tracker.state('rpc', 600)).toBe('unavailable');

    // Cooldown elapsed — recovery is evaluated on the next observation.
    expect(tracker.state('rpc', 1001)).toBe('healthy');
  });

  it('restarts the cooldown when a recovery probe fails', () => {
    const tracker = makeTracker();
    tracker.noteAttempt('rpc', false, 5, 0);
    tracker.noteAttempt('rpc', true, 5, 1500);
    // Probe fails after the cooldown — the clock on demotion starts over.
    tracker.noteAttempt('rpc', false, 5, 1600);
    tracker.noteAttempt('rpc', true, 5, 3000);

    // Streak of 1 only, and the 1600 demotion cooldown is still running here.
    expect(tracker.state('rpc', 3000)).toBe('unavailable');
    expect(tracker.state('rpc', 2601)).toBe('unavailable');
  });

  it('fires onStateChange for every transition and clears the window on recovery', () => {
    const events: [string, string, string][] = [];
    const tracker = makeTracker({
      onStateChange: (id, from, to) => events.push([id, from, to]),
    });

    tracker.noteAttempt('rpc', false, 5, 0);
    tracker.noteAttempt('rpc', true, 5, 1500);
    tracker.noteAttempt('rpc', true, 5, 1500);

    expect(events).toEqual([
      ['rpc', 'healthy', 'unavailable'],
      ['rpc', 'unavailable', 'healthy'],
    ]);
    // The demoted window must not drag the recovered source back down.
    expect(tracker.state('rpc', 1501)).toBe('healthy');
    expect(tracker.snapshot(1501)).toEqual({ rpc: 'healthy' });
  });

  it('slides the sample window so old failures stop counting', () => {
    const tracker = new SourceHealthTracker({
      config: { ...FAST, windowSize: 2, errorRateUnavailableThreshold: 1.01 },
    });
    // First failure: error rate 1.0 > 0.5 but under the unavailability line,
    // so the source lands degraded.
    tracker.noteAttempt('rpc', false, 1, 0);
    tracker.noteAttempt('rpc', true, 1, 2000);
    expect(tracker.state('rpc', 2000)).toBe('degraded');
    // The failure has now slid out of the 2-sample window and the streak of
    // two (with the cooldown elapsed) promotes it back.
    tracker.noteAttempt('rpc', true, 1, 3000);
    expect(tracker.state('rpc', 3000)).toBe('healthy');
  });

  it('exposes a stable numeric rank for the health gauge', () => {
    expect(SOURCE_HEALTH_STATE_RANK).toEqual({ healthy: 0, degraded: 1, unavailable: 2 });
  });
});

describe('withFailover routing', () => {
  function makePair(behaviour: {
    primary: () => Promise<string>;
    secondary?: () => Promise<string>;
  }): PrimarySecondary<[], string> {
    return {
      primary: { id: 'primary', invoke: behaviour.primary },
      ...(behaviour.secondary ? { secondary: { id: 'secondary', invoke: behaviour.secondary } } : {}),
    };
  }

  it('uses the primary while it is healthy and never touches the secondary', async () => {
    const tracker = makeTracker();
    const secondary = vi.fn(async () => 'secondary');
    const run = withFailover(makePair({ primary: async () => 'primary', secondary }), tracker, {
      now: () => 0,
    });

    expect(await run()).toBe('primary');
    expect(secondary).not.toHaveBeenCalled();
  });

  it('switches to the secondary while the primary is cooling down', async () => {
    const tracker = makeTracker();
    let primaryUp = false;
    const secondary = vi.fn(async () => 'secondary');
    const run = withFailover(
      makePair({
        primary: async () => {
          if (!primaryUp) throw new Error('primary down');
          return 'primary';
        },
        secondary,
      }),
      tracker,
      { now: () => 0 }
    );

    // First call: the failing primary probes itself over and the secondary lands it.
    expect(await run()).toBe('secondary');
    expect(tracker.state('primary', 0)).toBe('unavailable');
    expect(tracker.isCoolingDown('primary', 0)).toBe(true);

    // While cooling down the primary is bypassed entirely — the outage does
    // not add latency to every verification.
    primaryUp = true;
    expect(await run()).toBe('secondary');
    expect(secondary).toHaveBeenCalledTimes(2);
  });

  it('probes the primary once the cooldown elapses and fails back after the streak', async () => {
    const tracker = makeTracker();
    let nowMs = 0;
    let primaryUp = false;
    const primaryCalls: number[] = [];
    const run = withFailover(
      makePair({
        primary: async () => {
          primaryCalls.push(nowMs);
          if (!primaryUp) throw new Error('down');
          return 'primary';
        },
        secondary: async () => 'secondary',
      }),
      tracker,
      { now: () => nowMs }
    );

    expect(await run()).toBe('secondary'); // 0: primary fails, demoted at 0
    nowMs = 500;
    expect(await run()).toBe('secondary'); // still cooling — no primary call
    expect(primaryCalls).toEqual([0]);

    nowMs = 1001;
    primaryUp = true;
    expect(await run()).toBe('primary'); // cooldown expiry doubles as the probe
    expect(await run()).toBe('primary'); // streak of 2 met → healthy → failback
    expect(tracker.state('primary', nowMs)).toBe('healthy');
    expect(primaryCalls).toEqual([0, 1001, 1001]);
  });

  it('attempts the primary as last resort when the secondary is also down', async () => {
    const tracker = makeTracker();
    tracker.noteAttempt('primary', false, 1, 0); // demoted, in cooldown
    const primary = vi.fn(async (): Promise<string> => {
      throw new Error('primary down');
    });
    const secondary = vi.fn(async (): Promise<string> => {
      throw new Error('secondary down');
    });

    const run = withFailover(makePair({ primary, secondary }), tracker, { now: () => 0 });

    await expect(run()).rejects.toThrow('primary down');
    expect(secondary).toHaveBeenCalledTimes(1);
    expect(primary).toHaveBeenCalledTimes(1);
  });

  it('with no secondary behaves like the bare source and still records health', async () => {
    const tracker = makeTracker();
    const ok = vi.fn(async () => 'value');
    const run = withFailover(makePair({ primary: ok }), tracker, { now: () => 0 });

    expect(await run()).toBe('value');
    expect(tracker.snapshot(0)).toEqual({ primary: 'healthy' });

    const failingTracker = makeTracker();
    const failing = withFailover(
      makePair({
        primary: async () => {
          throw new Error('solo down');
        },
      }),
      failingTracker,
      { now: () => 1 }
    );
    await expect(failing()).rejects.toThrow('solo down');
    expect(failingTracker.state('primary', 1)).toBe('unavailable');
  });
});

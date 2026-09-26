/**
 * Automated source failover (issue #1051).
 *
 * The oracle's verdicts are only as good as the feeds behind them. Until now
 * a degraded indexer or RPC endpoint degraded every verdict silently — the
 * composition policy refuses to treat "we could not check" as "the payer
 * failed", so outages shrink confidence instead of tripping a wire. That is
 * the right call for a single attempt and the wrong call for a persistent
 * outage: the fix is to move the traffic, not to wait for a human to notice.
 *
 * This module owns both halves of that move:
 *
 *   - `SourceHealthTracker` — per-source sliding-window stats (success/error
 *     counts, latency samples, last-success time) and the healthy → degraded →
 *     unavailable state machine, including the hysteresis that keeps a source
 *     bouncing on and off the same threshold from oscillating roles.
 *   - `withFailover` — a wrapper that sends traffic to a source's primary
 *     while it is healthy, to its secondary while it is not, and back only
 *     after the recovery rules below have been satisfied.
 *
 * Recovery is deliberately slower than demotion: one bad window flips a
 * source away immediately (fail fast), but coming back requires
 * `recoverySuccesses` consecutive successes *and* a `cooldownMs` since the
 * demotion, with the cooldown restarting on any failed probe (fail slow,
 * anti-flap).
 */

export type SourceHealthState = 'healthy' | 'degraded' | 'unavailable';

/** Stable numeric encoding for the `oracle_source_health_state` gauge. */
export const SOURCE_HEALTH_STATE_RANK: Record<SourceHealthState, number> = {
  healthy: 0,
  degraded: 1,
  unavailable: 2,
};

export interface SourceFailoverConfig {
  /** Number of most-recent attempts kept per source for rate/latency math. */
  windowSize: number;
  /** Window error rate above this demotes a source to degraded. */
  errorRateThreshold: number;
  /** Window error rate at or above this demotes it straight to unavailable. */
  errorRateUnavailableThreshold: number;
  /** Window p95 latency above this (ms) demotes a source to degraded. */
  latencyP95ThresholdMs: number;
  /** No successful call within this many ms demotes a source to unavailable. */
  staleAfterMs: number;
  /** Consecutive successes required before a demoted source may recover. */
  recoverySuccesses: number;
  /** Minimum time since demotion before traffic may fail back to it. */
  cooldownMs: number;
}

export function defaultSourceFailoverConfig(): SourceFailoverConfig {
  return {
    windowSize: 50,
    errorRateThreshold: 0.5,
    errorRateUnavailableThreshold: 1,
    latencyP95ThresholdMs: 1500,
    staleAfterMs: 5 * 60 * 1000,
    recoverySuccesses: 5,
    cooldownMs: 60 * 1000,
  };
}

function readNumber(env: Record<string, string | undefined>, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Env overrides: ORACLE_FAILOVER_WINDOW_SIZE, ORACLE_FAILOVER_ERROR_RATE,
 * ORACLE_FAILOVER_ERROR_RATE_UNAVAILABLE, ORACLE_FAILOVER_P95_LATENCY_MS,
 * ORACLE_FAILOVER_STALE_AFTER_MS, ORACLE_FAILOVER_RECOVERY_SUCCESSES,
 * ORACLE_FAILOVER_COOLDOWN_MS.
 */
export function loadSourceFailoverConfig(
  env: Record<string, string | undefined> = process.env
): SourceFailoverConfig {
  const base = defaultSourceFailoverConfig();
  return {
    windowSize: readNumber(env, 'ORACLE_FAILOVER_WINDOW_SIZE') ?? base.windowSize,
    errorRateThreshold: readNumber(env, 'ORACLE_FAILOVER_ERROR_RATE') ?? base.errorRateThreshold,
    errorRateUnavailableThreshold:
      readNumber(env, 'ORACLE_FAILOVER_ERROR_RATE_UNAVAILABLE') ??
      base.errorRateUnavailableThreshold,
    latencyP95ThresholdMs:
      readNumber(env, 'ORACLE_FAILOVER_P95_LATENCY_MS') ?? base.latencyP95ThresholdMs,
    staleAfterMs: readNumber(env, 'ORACLE_FAILOVER_STALE_AFTER_MS') ?? base.staleAfterMs,
    recoverySuccesses:
      readNumber(env, 'ORACLE_FAILOVER_RECOVERY_SUCCESSES') ?? base.recoverySuccesses,
    cooldownMs: readNumber(env, 'ORACLE_FAILOVER_COOLDOWN_MS') ?? base.cooldownMs,
  };
}

interface AttemptSample {
  ok: boolean;
  latencyMs: number;
}

interface SourceRecord {
  samples: AttemptSample[];
  state: SourceHealthState;
  consecutiveSuccesses: number;
  lastSuccessAtMs: number;
  lastAttemptAtMs: number;
  demotedAtMs: number;
}

export interface SourceHealthTrackerOptions {
  config?: SourceFailoverConfig;
  now?: () => number;
  /** Fired on every state transition; wire metrics to it. */
  onStateChange?: (sourceId: string, from: SourceHealthState, to: SourceHealthState) => void;
}

function newRecord(): SourceRecord {
  return {
    samples: [],
    state: 'healthy',
    consecutiveSuccesses: 0,
    lastSuccessAtMs: 0,
    lastAttemptAtMs: 0,
    demotedAtMs: 0,
  };
}

function windowErrorRate(samples: AttemptSample[]): number {
  if (samples.length === 0) {
    return 0;
  }
  return samples.filter((sample) => !sample.ok).length / samples.length;
}

function p95LatencyMs(samples: AttemptSample[]): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

export class SourceHealthTracker {
  private readonly config: SourceFailoverConfig;
  private readonly now: () => number;
  private readonly onStateChange?: SourceHealthTrackerOptions['onStateChange'];
  private readonly records = new Map<string, SourceRecord>();

  constructor(options: SourceHealthTrackerOptions = {}) {
    this.config = options.config ?? defaultSourceFailoverConfig();
    this.now = options.now ?? Date.now;
    this.onStateChange = options.onStateChange;
  }

  /** Record one call outcome; this is what drives the state machine. */
  noteAttempt(sourceId: string, ok: boolean, latencyMs: number, nowMs = this.now()): void {
    const record = this.ensure(sourceId);
    record.samples.push({ ok, latencyMs });
    if (record.samples.length > this.config.windowSize) {
      record.samples.shift();
    }
    record.lastAttemptAtMs = nowMs;

    if (ok) {
      record.lastSuccessAtMs = nowMs;
      record.consecutiveSuccesses += 1;
    } else {
      record.consecutiveSuccesses = 0;
      // A failed probe while demoted restarts the cooldown, so a source that
      // is actually down is not hammered once per interval forever.
      if (record.state !== 'healthy') {
        record.demotedAtMs = nowMs;
      }
    }

    this.evaluate(sourceId, record, nowMs);
  }

  /** Current state of one source, re-evaluating time-based demotion. */
  state(sourceId: string, nowMs = this.now()): SourceHealthState {
    const record = this.ensure(sourceId);
    this.evaluate(sourceId, record, nowMs);
    return record.state;
  }

  /** True while a demoted source may not receive traffic back. */
  isCoolingDown(sourceId: string, nowMs = this.now()): boolean {
    const record = this.ensure(sourceId);
    const state = this.state(sourceId, nowMs);
    return state !== 'healthy' && nowMs - record.demotedAtMs < this.config.cooldownMs;
  }

  /** Every source the tracker has observed, for health payloads. */
  snapshot(nowMs = this.now()): Record<string, SourceHealthState> {
    const out: Record<string, SourceHealthState> = {};
    for (const sourceId of this.records.keys()) {
      out[sourceId] = this.state(sourceId, nowMs);
    }
    return out;
  }

  private ensure(sourceId: string): SourceRecord {
    let record = this.records.get(sourceId);
    if (!record) {
      record = newRecord();
      this.records.set(sourceId, record);
    }
    return record;
  }

  private evaluate(sourceId: string, record: SourceRecord, nowMs: number): void {
    const isStale =
      record.lastSuccessAtMs > 0 && nowMs - record.lastSuccessAtMs > this.config.staleAfterMs;

    if (record.state === 'healthy') {
      const errorRate = windowErrorRate(record.samples);
      let next: SourceHealthState = 'healthy';
      if (isStale || errorRate >= this.config.errorRateUnavailableThreshold) {
        next = 'unavailable';
      } else if (
        errorRate > this.config.errorRateThreshold ||
        p95LatencyMs(record.samples) > this.config.latencyP95ThresholdMs
      ) {
        next = 'degraded';
      }
      if (next !== 'healthy') {
        this.transition(sourceId, record, next, nowMs);
      }
      return;
    }

    // Demoted: stale/can't-reach states can only deepen, recovery requires
    // both the success streak and the cooldown (anti-flap hysteresis).
    if (record.state === 'degraded' && isStale) {
      this.transition(sourceId, record, 'unavailable', nowMs);
      return;
    }
    if (
      record.consecutiveSuccesses >= this.config.recoverySuccesses &&
      nowMs - record.demotedAtMs >= this.config.cooldownMs
    ) {
      this.transition(sourceId, record, 'healthy', nowMs);
    }
  }

  private transition(
    sourceId: string,
    record: SourceRecord,
    to: SourceHealthState,
    nowMs: number
  ): void {
    const from = record.state;
    if (from === to) {
      return;
    }
    record.state = to;
    if (to === 'healthy') {
      record.consecutiveSuccesses = 0;
      record.samples = [];
    } else {
      record.demotedAtMs = nowMs;
      record.consecutiveSuccesses = 0;
    }
    this.onStateChange?.(sourceId, from, to);
  }
}

export interface FailoverSource<TArgs extends unknown[], TOut> {
  /** Stable identifier used for health metrics and the health payload. */
  id: string;
  invoke: (...args: TArgs) => Promise<TOut>;
}

export interface PrimarySecondary<TArgs extends unknown[], TOut> {
  primary: FailoverSource<TArgs, TOut>;
  /** Optional: with no secondary the call always goes to the primary. */
  secondary?: FailoverSource<TArgs, TOut>;
}

/**
 * Wrap a primary/secondary pair in automated failover.
 *
 * While the primary is healthy it takes every call. Once demoted it is
 * bypassed entirely until its cooldown elapses, at which point one call is
 * allowed through as a recovery probe; success accumulates toward
 * `recoverySuccesses`, failure restarts the cooldown. When no secondary is
 * configured, behavior is identical to calling the primary directly.
 */
export function withFailover<TArgs extends unknown[], TOut>(
  pair: PrimarySecondary<TArgs, TOut>,
  tracker: SourceHealthTracker,
  options: { now?: () => number } = {}
): (...args: TArgs) => Promise<TOut> {
  const now = options.now ?? Date.now;

  return async (...args: TArgs): Promise<TOut> => {
    const nowMs = now();
    const { primary, secondary } = pair;

    let order: FailoverSource<TArgs, TOut>[];
    if (!secondary) {
      order = [primary];
    } else if (
      tracker.state(primary.id, nowMs) === 'healthy' ||
      !tracker.isCoolingDown(primary.id, nowMs)
    ) {
      // Healthy, or demoted but cooled down — either way the primary goes first
      // (the second call being the cooldown-expiry probe).
      order = [primary, secondary];
    } else {
      // Cooling down: the secondary carries the traffic, with the primary as
      // last resort so a total secondary outage still attempts something.
      order = [secondary, primary];
    }

    let lastError: unknown;
    for (const source of order) {
      const startedAt = Date.now();
      try {
        const result = await source.invoke(...args);
        tracker.noteAttempt(source.id, true, Date.now() - startedAt, now());
        return result;
      } catch (error) {
        tracker.noteAttempt(source.id, false, Date.now() - startedAt, now());
        lastError = error;
      }
    }
    throw lastError;
  };
}

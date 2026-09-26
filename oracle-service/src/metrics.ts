import client, { type Registry } from 'prom-client';

/**
 * Latency SLOs per oracle pipeline stage, in milliseconds (issue #1054).
 *
 * - fetch: source fetch (indexer history + on-chain reputation, in parallel).
 * - aggregate: trust-score computation and fraud-signal detection.
 * - publish: cache write plus response serialization.
 */
export const FETCH_SLO_MS = 500;
export const AGGREGATE_SLO_MS = 300;
export const PUBLISH_SLO_MS = 100;

/**
 * Burn-rate alert threshold (issue #1054): the ratio of SLO-violating stage
 * executions to total executions over the alert window that pages the
 * on-call. A burn rate above this means the stage is consuming its error
 * budget fast enough to breach the SLO within the window.
 */
export const SLO_BURN_RATE_ALERT_THRESHOLD = 0.01;

/**
 * sloBurnRate returns violations / total (0 when nothing has executed yet).
 * Callers compare the result against SLO_BURN_RATE_ALERT_THRESHOLD.
 */
export function sloBurnRate(violations: number, total: number): number {
  if (!Number.isFinite(violations) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.max(0, violations) / total;
}

export interface OracleMetrics {
  registry: Registry;
  verificationTotal: client.Counter<string>;
  cacheHitsTotal: client.Counter<string>;
  cacheMissesTotal: client.Counter<string>;
  staleResponsesTotal: client.Counter<string>;
  verificationDuration: client.Histogram<string>;
  /** Verdicts partitioned by composition outcome — the alerting signal. */
  verificationOutcomeTotal: client.Counter<string>;
  /** Individual fraud heuristics as they fire, by signal name. */
  fraudSignalTotal: client.Counter<string>;
  /** Rolling share of verdicts carrying at least one fraud signal, 0..1. */
  fraudFlagRatio: client.Gauge<string>;
  /** External provider lookups by resulting status. */
  externalVerificationTotal: client.Counter<string>;
  /** Attributed cost in USD */
  costUsdTotal: client.Counter<string>;
  /** SLO error-budget burn rate */
  sloErrorBudgetBurn: client.Gauge<string>;
  /** Latency SLO violations */
  latencySloViolationsTotal: client.Counter<string>;
  /** Record one verdict against the outcome, fraud and ratio metrics. */
  recordVerificationOutcome(result: VerificationOutcomeSample): void;
}

export interface VerificationOutcomeSample {
  outcome: string;
  fraudSignals: string[];
  externalStatus: string;
  cacheHit: boolean;
}

/**
 * Window over which the fraud-flag ratio is computed.
 *
 * A counter alone cannot answer "is the *share* of flagged submissions
 * abnormal?" without a rate() over two series, and the alert we actually want
 * — a sudden spike in fraud-flagged submissions, which signals either an attack
 * or a broken heuristic — is naturally expressed against a ratio. Keeping a
 * bounded in-process window makes that ratio available directly.
 */
export const FRAUD_RATIO_WINDOW = 200;

export function createOracleMetrics(): OracleMetrics {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const verificationTotal = new client.Counter({
    name: 'oracle_verification_requests_total',
    help: 'Total number of oracle verification requests received',
    registers: [registry],
  });

  const cacheHitsTotal = new client.Counter({
    name: 'oracle_cache_hits_total',
    help: 'Total number of oracle cache hits',
    registers: [registry],
  });

  const cacheMissesTotal = new client.Counter({
    name: 'oracle_cache_misses_total',
    help: 'Total number of oracle cache misses',
    registers: [registry],
  });

  const staleResponsesTotal = new client.Counter({
    name: 'oracle_stale_responses_total',
    help: 'Total number of stale oracle responses returned',
    registers: [registry],
  });

  const verificationDuration = new client.Histogram({
    name: 'oracle_verification_duration_seconds',
    help: 'Oracle verification latency in seconds',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const verificationOutcomeTotal = new client.Counter({
    name: 'oracle_verification_outcome_total',
    help: 'Oracle verification verdicts by composition outcome',
    labelNames: ['outcome', 'external_status', 'cache_hit'] as const,
    registers: [registry],
  });

  const fraudSignalTotal = new client.Counter({
    name: 'oracle_fraud_signal_total',
    help: 'Individual fraud heuristics fired, by signal',
    labelNames: ['signal'] as const,
    registers: [registry],
  });

  const fraudFlagRatio = new client.Gauge({
    name: 'oracle_fraud_flag_ratio',
    help: `Share of the last ${FRAUD_RATIO_WINDOW} verdicts carrying a fraud signal (0..1)`,
    registers: [registry],
  });

  const externalVerificationTotal = new client.Counter({
    name: 'oracle_external_verification_total',
    help: 'External provider lookups by resulting status',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  const costUsdTotal = new client.Counter({
    name: 'oracle_cost_usd_total',
    help: 'Attributed cost in USD by operation',
    labelNames: ['operation'] as const,
    registers: [registry],
  });

  const sloErrorBudgetBurn = new client.Gauge({
    name: 'oracle_slo_error_budget_burn',
    help: 'Current SLO error-budget burn rate by SLO name',
    labelNames: ['slo'] as const,
    registers: [registry],
  });

  const latencySloViolationsTotal = new client.Counter({
    name: 'oracle_latency_slo_violations_total',
    help: 'Count of verification latency SLO violations (p95 > threshold)',
    registers: [registry],
  });

  // Bounded ring of recent verdicts backing the ratio gauge.
  const recentFlags: boolean[] = [];

  function recordVerificationOutcome(result: VerificationOutcomeSample): void {
    verificationOutcomeTotal.inc({
      outcome: result.outcome,
      external_status: result.externalStatus,
      cache_hit: String(result.cacheHit),
    });

    externalVerificationTotal.inc({ status: result.externalStatus });

    for (const signal of result.fraudSignals) {
      fraudSignalTotal.inc({ signal });
    }

    // Cache hits are replays of an earlier verdict, not new observations.
    // Counting them would let one flagged payer retrying in a loop drag the
    // ratio up and page someone for a single actor.
    if (result.cacheHit) {
      return;
    }

    recentFlags.push(result.fraudSignals.length > 0);
    if (recentFlags.length > FRAUD_RATIO_WINDOW) {
      recentFlags.shift();
    }

    const flagged = recentFlags.filter(Boolean).length;
    fraudFlagRatio.set(recentFlags.length === 0 ? 0 : flagged / recentFlags.length);
  }

  // Cost attribution: $0.001 per verification (RPC + attestation)
  function observeVerificationCost(): void {
    try {
      costUsdTotal.inc({ operation: 'verification' }, 0.001);
    } catch {}
  }

  const wrappedRecordVerificationOutcome = (result: VerificationOutcomeSample): void => {
    recordVerificationOutcome(result);
    observeVerificationCost();
  };

  return {
    registry,
    verificationTotal,
    cacheHitsTotal,
    cacheMissesTotal,
    staleResponsesTotal,
    verificationDuration,
    verificationOutcomeTotal,
    fraudSignalTotal,
    fraudFlagRatio,
    externalVerificationTotal,
    costUsdTotal,
    sloErrorBudgetBurn,
    latencySloViolationsTotal,
    recordVerificationOutcome: wrappedRecordVerificationOutcome,
  };
}

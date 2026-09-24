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
  fetchDuration: client.Histogram<string>;
  aggregateDuration: client.Histogram<string>;
  publishDuration: client.Histogram<string>;
  fetchSloViolationsTotal: client.Counter<string>;
  aggregateSloViolationsTotal: client.Counter<string>;
  publishSloViolationsTotal: client.Counter<string>;
  degradedResponsesTotal: client.Counter<string>;
  lastKnownGoodAgeSeconds: client.Gauge<string>;
}

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

  const fetchDuration = new client.Histogram({
    name: 'oracle_fetch_duration_seconds',
    help: 'Oracle source-fetch stage latency in seconds (indexer history + on-chain reputation)',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const aggregateDuration = new client.Histogram({
    name: 'oracle_aggregate_duration_seconds',
    help: 'Oracle aggregate stage latency in seconds (trust-score computation)',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const publishDuration = new client.Histogram({
    name: 'oracle_publish_duration_seconds',
    help: 'Oracle publish stage latency in seconds (cache write + response serialization)',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const fetchSloViolationsTotal = new client.Counter({
    name: 'oracle_fetch_slo_violations_total',
    help: 'Total number of fetch-stage executions breaching FETCH_SLO_MS',
    registers: [registry],
  });

  const aggregateSloViolationsTotal = new client.Counter({
    name: 'oracle_aggregate_slo_violations_total',
    help: 'Total number of aggregate-stage executions breaching AGGREGATE_SLO_MS',
    registers: [registry],
  });

  const publishSloViolationsTotal = new client.Counter({
    name: 'oracle_publish_slo_violations_total',
    help: 'Total number of publish-stage executions breaching PUBLISH_SLO_MS',
    registers: [registry],
  });

  const degradedResponsesTotal = new client.Counter({
    name: 'oracle_degraded_responses_total',
    help: 'Total number of degraded-mode (last-known-good) responses served',
    registers: [registry],
  });

  const lastKnownGoodAgeSeconds = new client.Gauge({
    name: 'oracle_last_known_good_age_seconds',
    help: 'Age in seconds of the last-known-good cached response served in degraded mode',
    registers: [registry],
  });

  return {
    registry,
    verificationTotal,
    cacheHitsTotal,
    cacheMissesTotal,
    staleResponsesTotal,
    verificationDuration,
    fetchDuration,
    aggregateDuration,
    publishDuration,
    fetchSloViolationsTotal,
    aggregateSloViolationsTotal,
    publishSloViolationsTotal,
    degradedResponsesTotal,
    lastKnownGoodAgeSeconds,
  };
}

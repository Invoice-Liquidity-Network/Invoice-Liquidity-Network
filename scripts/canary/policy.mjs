/**
 * scripts/canary/policy.mjs
 *
 * Per-service canary duration and promotion criteria (issue #1095). Reuses
 * the exact fast-burn thresholds already defined in
 * monitoring/prometheus/slo-alerts.yml so a canary is never held to a
 * different bar than the SLOs it's meant to protect — see docs/slos.md and
 * docs/canary-deployment.md for the rationale behind each number.
 *
 * A canary is intentionally *stricter on time, not on threshold*: production
 * MWMBR alerting waits for a confirmatory long window (1h/6h) before paging,
 * because paging on a blip is costly. A canary carries a small, disposable
 * slice of traffic, so the right trade is the opposite: react to a single
 * bad short-window sample immediately (bakeMinutes below is a ceiling, not a
 * requirement to wait out a bad signal).
 */

export const CANARY_POLICIES = {
  indexer: {
    bakeMinutes: 15,
    pollIntervalSeconds: 60,
    // Matches slo-indexer-read-api fast-burn thresholds (0.1% SLO budget * 14x).
    maxErrorRatio: 0.001 * 14,
    maxLatencyP95Seconds: 0.2,
    metricsPath: '/metrics',
    // Raw counters behind slo:indexer_availability:error_ratio_5m / slo:indexer_latency:p95_5m,
    // re-queried scoped to {deployment="canary"} rather than reusing the cluster-wide recording
    // rule, which has no canary/stable split.
    metrics: {
      errorNumerator: 'iln_http_errors_total',
      errorDenominator: 'iln_http_requests_total',
      latencyBucket: 'iln_http_request_duration_seconds_bucket',
    },
  },
  'oracle-service': {
    bakeMinutes: 20,
    pollIntervalSeconds: 60,
    // Matches slo-oracle-freshness fast-burn thresholds (0.5% SLO budget * 6x).
    maxErrorRatio: 0.005 * 6,
    maxLatencyP95Seconds: 1,
    metricsPath: '/v1/metrics',
    metrics: {
      errorNumerator: 'oracle_stale_responses_total',
      errorDenominator: 'oracle_verification_requests_total',
      latencyBucket: 'oracle_verification_duration_seconds_bucket',
    },
  },
  notifications: {
    bakeMinutes: 15,
    pollIntervalSeconds: 60,
    // Matches slo-notification-delivery fast-burn thresholds (0.1% SLO budget * 14x).
    maxErrorRatio: 0.001 * 14,
    maxLatencyP95Seconds: 5,
    metricsPath: '/metrics',
    metrics: {
      errorNumerator: 'iln_notifications_failures_total',
      errorDenominator: 'iln_notifications_dispatches_total',
      latencyBucket: 'iln_notifications_delivery_duration_seconds_bucket',
    },
  },
};

export function getPolicy(service) {
  const policy = CANARY_POLICIES[service];
  if (!policy) {
    throw new Error(
      `Unknown canary service "${service}". Expected one of: ${Object.keys(CANARY_POLICIES).join(', ')}`
    );
  }
  return policy;
}

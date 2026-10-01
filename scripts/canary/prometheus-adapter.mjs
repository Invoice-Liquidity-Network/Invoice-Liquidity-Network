/**
 * scripts/canary/prometheus-adapter.mjs
 *
 * Builds the PromQL for a canary-scoped SLI sample and queries a Prometheus
 * HTTP API for it. The query builder is a pure function (unit-tested without
 * a live Prometheus); `queryInstantVector` is the only I/O, isolated so
 * rollout.mjs can inject a fake for the drill (scripts/canary/rollout-drill.mjs).
 *
 * Canary instances must be registered as Prometheus scrape targets labeled
 * `deployment="canary"` and `service="<name>"` — see
 * scripts/canary/register-target.mjs and docs/canary-deployment.md.
 */

/** Builds the error-ratio PromQL for a service's canary instance. */
export function buildErrorRatioQuery(policy, service) {
  const { errorNumerator, errorDenominator } = policy.metrics;
  const selector = `{deployment="canary",service="${service}"}`;
  return (
    `sum(rate(${errorNumerator}${selector}[5m])) / ` +
    `clamp_min(sum(rate(${errorDenominator}${selector}[5m])), 0.0001)`
  );
}

/** Builds the p95 latency PromQL for a service's canary instance. */
export function buildLatencyQuery(policy, service) {
  const selector = `{deployment="canary",service="${service}"}`;
  return `histogram_quantile(0.95, sum(rate(${policy.metrics.latencyBucket}${selector}[5m])) by (le))`;
}

/** Extracts the scalar value from a Prometheus instant-query JSON response. Returns 0 for an empty result (no traffic yet = no errors yet). */
export function parseInstantVectorValue(promResponseJson) {
  const result = promResponseJson?.data?.result;
  if (!Array.isArray(result) || result.length === 0) {
    return 0;
  }
  const value = result[0].value?.[1];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Queries a Prometheus HTTP API instant query endpoint and returns the
 * parsed scalar value. Requires global `fetch` (Node 20+).
 */
export async function queryInstantVector(prometheusUrl, promql) {
  const url = `${prometheusUrl.replace(/\/$/, '')}/api/v1/query?query=${encodeURIComponent(promql)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Prometheus query failed (${res.status}): ${promql}`);
  }
  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error(`Prometheus query returned status "${json.status}" for: ${promql}`);
  }
  return parseInstantVectorValue(json);
}

/**
 * Samples both SLIs for a service's canary instance in one call. This is the
 * function rollout.mjs polls on each tick.
 */
export async function sampleCanary(prometheusUrl, policy, service) {
  const [errorRatio, latencyP95Seconds] = await Promise.all([
    queryInstantVector(prometheusUrl, buildErrorRatioQuery(policy, service)),
    queryInstantVector(prometheusUrl, buildLatencyQuery(policy, service)),
  ]);
  return { errorRatio, latencyP95Seconds };
}

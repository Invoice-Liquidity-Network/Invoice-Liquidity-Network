# Monitoring — Oracle Latency SLOs — Issue #1054

## Oracle pipeline stages and SLOs

`oracle-service/src/metrics.ts` instruments end-to-end latency per pipeline
stage. Each stage has an explicit SLO; breaches increment a dedicated
violation counter so burn-rate alerting can fire before creeping latency
becomes a staleness incident.

| Stage | What it measures | Metric | SLO | Violation counter |
|---|---|---|---|---|
| fetch | Source fetch: indexer history + on-chain reputation (parallel) | `oracle_fetch_duration_seconds` | 500 ms (`FETCH_SLO_MS`) | `oracle_fetch_slo_violations_total` |
| aggregate | Trust-score computation + fraud-signal detection | `oracle_aggregate_duration_seconds` | 300 ms (`AGGREGATE_SLO_MS`) | `oracle_aggregate_slo_violations_total` |
| publish | Cache write + response serialization | `oracle_publish_duration_seconds` | 100 ms (`PUBLISH_SLO_MS`) | `oracle_publish_slo_violations_total` |
| overall | Full verification path (pre-existing) | `oracle_verification_duration_seconds` | — | — |

Degraded-mode observability (issue #1057) rides the same registry:

| Metric | Meaning |
|---|---|
| `oracle_degraded_responses_total` | Last-known-good (stale) responses served |
| `oracle_last_known_good_age_seconds` | Age of the last stale response served |
| `oracle_stale_responses_total` (pre-existing) | Responses older than `maxOracleAgeMs` |

## Burn-rate alerting

`sloBurnRate(violations, total)` in `metrics.ts` returns
`violations / total` (0 with no traffic). Alert when the burn rate exceeds
`SLO_BURN_RATE_ALERT_THRESHOLD` (0.01) over the alert window — i.e. a stage
is consuming its error budget fast enough to breach SLO within the window.

Prometheus recording/alert sketch for the unified dashboard:

```promql
# fetch-stage burn rate over 5m
sum(rate(oracle_fetch_slo_violations_total[5m]))
/
sum(rate(oracle_verification_requests_total[5m])) > 0.01
```

Repeat per stage (`aggregate`, `publish`). Page the on-call when any stage
burns above threshold for 15 minutes; ticket when above threshold for 1 hour.

## Unified metrics dashboard

Scrape the oracle `/metrics` (and `/v1/metrics`) endpoints alongside the
other services. Recommended panels:

1. **Stage latency heatmap** — p50/p95/p99 of the three
   `oracle_*_duration_seconds` histograms per instance.
2. **SLO burn-rate graph** — one line per stage using the query above.
3. **Degraded-mode banner** — `oracle_degraded_responses_total` rate plus
   `oracle_last_known_good_age_seconds`; any non-zero degraded rate turns
   the oracle row red.
4. **Health snapshot** — `/v1/health` already returns `degradedMode`,
   `degradedResponses`, and per-stage `sloViolations` totals for
   status-page wiring without scraping Prometheus.

## Verifying locally

```bash
cd oracle-service
./node_modules/.bin/vitest run src/degraded-mode.test.ts src/cache.test.ts
curl -s localhost:3010/metrics | grep -E 'oracle_(fetch|aggregate|publish)_duration_seconds|oracle_degraded_responses_total'
```

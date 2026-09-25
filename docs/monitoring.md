# Operational Monitoring & Grafana Observability

This document defines the production observability stack for the **Invoice Liquidity Network (ILN)** monorepo, covering metrics collection, Prometheus scraping, Grafana visualization, synthetic canary health verification **(now full critical-path correctness)**, and **cross-service distributed tracing** across all core microservices: **Indexer**, **Oracle Service**, **Notifications Service**, and the **TypeScript SDK**.

---

## 1. Overview & Operational Architecture

The ILN observability pipeline aggregates business metrics, service-level performance indicators (SLIs), and host runtime health into a unified Prometheus and Grafana deployment, complemented by active synthetic canaries and W3C trace context.

```
                  ┌────────────────────────┐
                  │   Grafana Dashboard    │
                  │ (monitoring/grafana/)  │
                  └───────────▲────────────┘
                              │ PromQL  (+ Exemplars → Traces)
                  ┌───────────┴────────────┐
                  │   Prometheus Server    │
                  └───────────▲────────────┘
                              │ HTTP GET /metrics + /traces (OTLP)
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────┴───────┐     ┌───────┴───────┐     ┌───────┴───────┐
│ Indexer API   │◄───►│ Oracle Service│◄───►│ Notifications │
│ (Port 3001)   │     │ (Port 3010)   │     │ (Port 4001)   │
└───────────────┘     └───────────────┘     └───────────────┘
        ▲  traceparent propagation (W3C) ▲
        └─────────────────────────────────┘
```

---

## 2. Service Metric Endpoints

Every backend service in the monorepo exposes a standard Prometheus `/metrics` endpoint:

| Service | HTTP Port | Primary Endpoint | Prom-Client Prefix / Metric Types |
| --- | --- | --- | --- |
| **Indexer Service** | `3001` | `http://localhost:3001/metrics` | `iln_*` (Process, Ledger Cursor, DB Latency, Contract Errors) |
| **Oracle Service** | `3010` | `http://localhost:3010/v1/metrics` | `oracle_*` (Requests, Cache Hits/Misses, Stale Responses, Latency) |
| **Notifications Service** | `4001` | `http://localhost:4001/metrics` | `iln_notifications_*` (Dispatches, Failures, Rate Limits, Subscriptions) |
| **SDK & OpenTelemetry** | Client-side | Exposed via OTel Meter | `iln_transaction_*`, `iln_simulation_*`, `iln_error_count_*` |
| **Traces (OTLP)** | `4317`/`4318` | `http://collector:4317` (gRPC) / `http://collector:4318` (HTTP) | W3C traceparent exemplars linked from Prometheus |

---

## 3. Prometheus Scrape Target Configuration

The production Prometheus configuration is located at `monitoring/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'iln-indexer'
    static_configs:
      - targets: ['indexer:3001']

  - job_name: 'iln-oracle'
    static_configs:
      - targets: ['oracle-service:3010']

  - job_name: 'iln-notifications'
    static_configs:
      - targets: ['notifications:4001']

  # OTel Collector (for traces, when configured)
  - job_name: 'otel-collector'
    static_configs:
      - targets: ['otel-collector:8889']
```

---

## 4. Unified Production Grafana Dashboard

The canonical production Grafana dashboard is located at **`monitoring/grafana/dashboard.json`** (also mirrored at `examples/grafana/dashboard.json`).

### Dashboard Structure & Panel Groups

1. **Protocol Business Metrics**:
   - **Invoice Submissions per Hour**: `rate(iln_invoice_submissions_total[1h])`
   - **Funded Invoices per Hour**: `rate(iln_funded_invoices_total[1h])`
   - **Settlement Rate**: `irate(iln_paid_invoices_total[5m]) / irate(iln_funded_invoices_total[5m])`
   - **Dispute / Default Rate**: `irate(iln_defaulted_invoices_total[5m]) / irate(iln_invoice_submissions_total[5m])`
   - **Average Transaction Fee**: `iln_transaction_fee_sum / iln_transaction_fee_count`
   - **LP Portfolio Distribution**: `sum by (lp) (iln_lp_portfolio_size_usd)`
   - **Contract Errors by Type**: `sum by (error_type) (rate(iln_contract_error_total[5m]))`

2. **Indexer Service Operations**:
   - **Last Processed Ledger**: `iln_last_processed_ledger`
   - **Ledger Cursor Sync Lag**: `time() - (iln_cursor_updated_at / 1000)`
   - **Event Processing Throughput**: `rate(iln_events_processed_total[5m])`
   - **Invoices Upsert Rate**: `rate(iln_invoices_upserted_total[5m])`
   - **DB Query Latency (p95/p99)**: `histogram_quantile(0.95, sum(rate(iln_db_query_duration_seconds_bucket[5m])) by (le))`
   - **Database Error Rate**: `rate(iln_db_errors_total[5m])`

3. **Oracle Service Performance & Accuracy**:
   - **Verification Request Rate**: `rate(oracle_verification_requests_total[5m])`
   - **Cache Hit vs Miss Ratio**: `rate(oracle_cache_hits_total[5m])` vs `rate(oracle_cache_misses_total[5m])`
   - **Stale Response Rate**: `rate(oracle_stale_responses_total[5m])`
   - **Verification Latency (p95/p99)**: `histogram_quantile(0.95, sum(rate(oracle_verification_duration_seconds_bucket[5m])) by (le))`

4. **Notifications Service & Channel Health**:
   - **Dispatches by Channel**: `sum by (channel) (rate(iln_notifications_dispatches_total[5m]))`
   - **Delivery Failure Rate**: `sum by (channel, reason) (rate(iln_notifications_failures_total[5m]))`
   - **Rate Limit Rejections (429s)**: `sum by (channel) (rate(iln_notifications_rate_limit_hits_total[5m]))`
   - **Notification Latency (p95)**: `histogram_quantile(0.95, sum(rate(iln_notifications_delivery_duration_seconds_bucket[5m])) by (le, channel))`
   - **Active Subscriptions**: `sum by (channel) (iln_notifications_active_subscriptions)`

5. **SDK & Client Telemetry**:
   - **Transaction Build & Simulation Latency**: `histogram_quantile(0.95, sum(rate(iln_transaction_duration_ms_bucket[5m])) by (le))`
   - **SDK Errors by Method & Code**: `sum by (method, code) (rate(iln_error_count_total[5m]))`

6. **System Resource Utilization**:
   - **Memory Usage (RSS)**: `sum by (job) (process_resident_memory_bytes)`
   - **CPU Usage Rate**: `sum by (job) (rate(process_cpu_seconds_total[5m]))`
   - **Event Loop Lag**: `sum by (job) (nodejs_eventloop_lag_seconds)`

7. **Distributed Traces (new)**:
   - **Trace Rate by Service**: `rate(traces_span_count[5m])` by `service.name`
   - **Cross-Service Latency (p95)**: `histogram_quantile(0.95, rate(traces_span_duration_seconds_bucket[5m]))` by `operation`
   - **Error Traces**: `rate(traces_span_errors_total[5m])`
   - Grafana *Explore → Traces* (Tempo/Jaeger datasource) linked from metrics via exemplars (`/metrics` exposes `trace_id` as exemplar).

---

## 5. Importing the Dashboard into Grafana

1. Log into your Grafana instance (`http://localhost:3000`).
2. Navigate to **Dashboards** -> **Import**.
3. Select **Upload JSON file** and choose `monitoring/grafana/dashboard.json`.
4. Select your configured Prometheus data source and click **Import**.

---

## 6. Synthetic Canary Integration — Full Critical-Path Coverage

The Grafana dashboard is complemented by active synthetic probes that exercise **every integrator-critical path end-to-end with correctness assertions**, not just HTTP 200. The prober lives at `scripts/synthetic-canary.ts` and runs as a scheduled workflow (`.github/workflows/synthetic-canary.yml` every 15 min + off-line unit tests).

### Why liveness alone is insufficient
A service can return `200 OK` while still being broken for integrators: pagination may overlap, GraphQL may diverge from REST, subscription writes may 500 while health passes, oracle may return stale trust scores from cache. The hardened canary catches those regressions by asserting **read-then-verify consistency** and schema correctness.

### Covered critical paths & pass/fail criteria

| Path (check name) | What it proves for integrators | Pass criterion | Fail severity | Runbook (direct) |
|---|---|---|---|---|
| **Indexer** | | | | |
| `indexer:health` | API process up & DB connected | `200` + `{status:"ok", db:"ok"}` | **P1** | [Incident #Signal-2](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#signal-2-indexer-lag--ingestion-health) |
| `indexer:health:freshness` | Not stale (ledger lag) | `lastSync` < 5 min old, `syncLag` < 300s | **P1** | same |
| `indexer:invoice:${id}` | Canary invoice readable | `id` matches, `invoice` object present | **P1** | [Scenario B](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#scenario-b-indexer-data-loss-or-state-corruption) |
| `indexer:invoice:schema` | Schema hasn't drifted | `id: number, freelancer/payer: string, amount: numeric-string, status ∈ enum` | **P1** | same |
| `indexer:list:pagination` | Pagination correct (integrators list) | `limit=2` → `hasMore`+`nextCursor` consistent, pages disjoint, sorted ASC | **P2** | [Monitoring §4](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/monitoring.md#indexer-service-operations) |
| `indexer:filter:status` | Filtering not broken | `status=Funded` → all rows `status==="Funded"` | **P2** | same |
| `indexer:stats` / `indexer:stats:sanity` | Stats not stale / negative | `totalInvoices: number ≥0, defaultRate 0–1` | **P3** | same |
| `indexer:graphql:consistency` | REST ↔ GraphQL parity (**read-then-verify-consistency flow**) | `REST /v1/invoice/:id` vs `POST /graphql { invoice(id) }` fields byte-equal | **P2** | same |
| `indexer:history` | History endpoint honest | array + schema valid | **P3** | same |
| `indexer:dashboard` | Dashboard not lying about lag | `sync.syncLag` numeric < 600s | **P2** | same |
| **Oracle** | | | | |
| `oracle:health` | Process up | `200` + `status ok/degraded` | **P1** | [Scenario C](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#scenario-c-oracle-service-compromise-or-malfunction) |
| `oracle:verify:${addr}` | Real verification works | `isVerified: boolean, trustScore 0–100, confidence ∈ {low,medium,high,unknown}` | **P1** | same |
| `oracle:verify:schema` | No field drift | strict type/range checks | **P1** | same |
| `oracle:cache` | Cache not poisoned | 2nd verify (same payer) → `cacheHit:true` + same `trustScore` | **P2** | [Oracle docs](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/oracle-service.md#cache-invalidation) |
| `oracle:validation` | Input validation still enforced | `payer=INVALID` → `400` + `error` field | **P2** | same |
| `oracle:metrics` | Metrics not missing | `/v1/metrics` contains `oracle_verification` series | **P3** | [Monitoring §4.3](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/monitoring.md#oracle-service-performance--accuracy) |
| `oracle:staleness` | Not serving stale verdicts | `dataAgeMs ≤ maxOracleAgeMs` | **P2** | same |
| **Notifications** | | | | |
| `notifications:health` | Process up | `200` + `status:"ok"` | **P1** | [Signal-3](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#signal-3-notification-service-failures) |
| `notifications:channel:email` | Email subscription path up | `POST /subscribe email` → `201`/`409` not `5xx`, rate-limit headers | **P1** | same |
| `notifications:channel:webhook` | Webhook dispatch up | `POST /test-webhook` → `success:true` or health proxy | **P1** | [Signal-4](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#signal-4-webhook-delivery-errors) |
| `notifications:channel:sms` | SMS validation up | `POST /subscribe sms` with E.164 test number → not `5xx` | **P2** | [Signal-3](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#signal-3-notification-service-failures) |
| `notifications:channel:websocket` | WS heartbeat | `ws://…/ws` → `type:"heartbeat"` | **P1** | same |
| `notifications:websocket:subscribe` | Real subscribe flow | `subscribe` → `unsubscribe` without `type:"error"` | **P2** | [Notifications arch](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/notifications.md#architectural-note-notifications-websocket-vs-indexer-subscription) |
| `notifications:subscription:roundtrip` | Full lifecycle works (not just health) | `POST /subscribe` → `GET /subscriptions/:addr` contains it → `POST /test-webhook` → `DELETE` | **P1** | [Signal-4](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#signal-4-webhook-delivery-errors) |
| `notifications:analytics:shape` | Analytics not broken | `GET /analytics` keys non-empty | **P3** | [Monitoring §4.4](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/monitoring.md#signal-4-notifications-service--channel-health) |
| `notifications:channel-comparison` | Channel breakdown up | `/analytics/channel-comparison` shape valid | **P3** | same |
| `notifications:trends` | Trends not broken | `/analytics/trends?days=7` → `trends` present | **P3** | same |
| `notifications:rate-limit` | Rate limiter headers present | `X-RateLimit-*` on `POST /subscribe` | **P3** | [Notifications docs](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/notifications.md#rate-limits-and-delivery-guarantees) |
| `notifications:preferences` | Preferences not broken | `GET /preferences/:address` → not 5xx | **P3** | same |
| **Cross-service** | | | | |
| `cross:consistency:indexer-oracle` | Indexer ↔ Oracle agreement | `GET /v1/history/:payer` + `POST /v1/verify {payer}` both succeed, same payer, `trustScore` consistent | **P1** | [Scenario C](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#scenario-c-oracle-service-compromise-or-malfunction) |
| `cross:read-verify` | Read-then-verify-consistency flow | `GET /v1/invoice/:id` → `POST /v1/verify {payer}` | **P1** | same |

Each row is an individual `CheckResult` (`runAllCanaryChecks()` returns 26+ checks; `passed` is `every(c.passed)`). Every failure carries `runbookUrl` + `severity` so the workflow can page with a clickable runbook.

### On-demand execution

```bash
pnpm exec tsx scripts/synthetic-canary.ts
# env overrides
INDEXER_BASE_URL=https://indexer.iln.finance \
ORACLE_BASE_URL=https://oracle.iln.finance \
NOTIFICATIONS_BASE_URL=https://notifications.iln.finance \
tsx scripts/synthetic-canary.ts
```

### How failures page

- **Workflow**: `.github/workflows/synthetic-canary.yml` — `canary-unit-tests` (offline mocks) always runs; `canary-live-probe` runs when `INDEXER_BASE_URL` is set. On failure it:
  1. uploads `canary-output.log` as artifact (14-day retention),
  2. prints **direct runbook links** in the log group `🔗 Runbook links for failed checks`,
  3. emits a `::error title=Synthetic Canary Failed — P1::…` annotation (surfaces in PR/commit status),
  4. posts a JSON alert to `ALERT_WEBHOOK_URL` (Slack/PagerDuty) with `runbookUrl` + `severity` blocks, and (best-effort) opens a `incident,canary` GitHub issue.
- **Script**: `postAlert(message, runbookUrl, severity)` sends a Slack Block Kit payload with a `Runbook: <…|Open runbook>` button.
- **Local**: every failed line in stdout ends with `↳ https://github.com/…/incident-response.md#…`

### Off-line tests (CI without live services)

`tests/synthetic/canary.test.ts` spins up three local HTTP servers plus a `MockWebSocket` that emits a real heartbeat frame. All 26+ critical-path checks are exercised there (`pnpm vitest run tests/synthetic/canary.test.ts`). The mock servers implement pagination cursor, GraphQL parity, subscription lifecycle, cache behavior, and cross-service history so the critical-path assertions are tested without external dependencies.

---

## 7. Distributed Tracing — Shared Trace Context Across Services

> **Scope**: indexer, oracle-service, and notifications — exactly the three services in `docs/monitoring.md`'s scope. A latency spike or failure that bounces across those boundaries used to require manual log-correlation by timestamp; it now appears as a single trace.

### Mechanism

- **Propagation**: [W3C `traceparent`](https://www.w3.org/TR/trace-context/) (`00-${traceId}-${parentId}-${flags}`) + optional `tracestate`.
- **Generation**: if no inbound `traceparent` is present, `traceMiddleware(serviceName)` generates one (`00-${random16Bytes}-${random8Bytes}-01`), validates it via `TRACEPARENT_REGEX`, and reflects it in the response (`traceparent` + `X-Trace-Id`). If a valid `traceparent` is present, it is forwarded verbatim.
- **Storage**: `AsyncLocalStorage<TraceContext>` holds the active trace for the request lifetime; downstream `fetch` calls inherit it.
- **Span creation**: `traceMiddleware` opens a `SERVER` span per HTTP request (`http.method`, `http.route`, `trace.id`, `http.status_code`, `http.duration_ms`). Handlers that do cross-service I/O open `INTERNAL` spans via `withSpan('oracle.verify', {...})` or `withSpan('notifications.webhook.dispatch', {...})`.
- **Forwarding**: `propagateFetch(init)` injects `traceparent`/`tracestate` into outbound `fetch` headers; the oracle's `fetchJson` (history fetch from indexer) and notifications' `sendWebhook` both use it, so a canary's `cross:read-verify` traversal appears as one trace (`indexer: GET /v1/invoice/42` → `oracle: POST /v1/verify` with same `traceId`).

### Instrumented call paths (spans you will see in a trace view)

| Edge | Span name | Attributes sampled |
|------|-----------|---------------------|
| `indexer` inbound | `GET /v1/invoice/:id`, `GET /v1/invoices`, `POST /graphql`, etc. | `http.method`, `http.route`, `trace.id` |
| `oracle` inbound | `POST /v1/verify` (SERVER) + `oracle.verify` (INTERNAL) | `payer` (short), `invoiceId`, `cacheHit` |
| `oracle → indexer` | `fetchJson` inside `createHistoryProvider` | `http.url` (history URL), parent is `oracle.verify` |
| `notifications` inbound | `POST /subscribe`, `GET /subscriptions/:addr`, etc. | `http.*` |
| `notifications → webhook` | `notifications.webhook.dispatch` | `destination`, `trigger` |
| SDK (optional) | `ILNClient.*` | `iln.method`, `iln.invoice_id`, etc. (via `ILNInstrumentation`) |

### Backend wiring (queryable during incident response)

Traces are exported via OpenTelemetry OTLP. The services are backend-agnostic; the collector is configured by environment — the same code writes to **whichever you operate** (Tempo, Jaeger, Honeycomb, Datadog APM). The reference docker-compose (`docker-compose.yml`) runs `otel-collector` and forwards to `jaeger` for local dev.

```bash
# Production example — point any service at your collector:
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.iln.finance:4317   # gRPC
OTEL_SERVICE_NAME=indexer            # or oracle-service / notifications
OTEL_TRACES_SAMPLER=parentbased_always_on
# Optional: forward to Grafana Tempo and correlate with Prometheus exemplars
OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=...,x-dataset=iln"
```

The shared package is `packages/opentelemetry` (`@iln/opentelemetry`). The middleware re-exports are:

```typescript
import { traceMiddleware, withSpan, propagateFetch, getCurrentTraceParent, isValidTraceParent } from '@iln/opentelemetry/tracing';
app.use(traceMiddleware('indexer'));               // must be first middleware
await withSpan('indexer.db.query', { 'iln.invoice_id': 42 }, async (span) => db.get(...));
await fetch(url, propagateFetch({ headers: {}, signal })); // forwards traceparent
```

When no OTEL SDK is configured (e.g. local `pnpm dev`), the helpers degrade to header-only propagation and emit no-op spans, so tracing never breaks the request path.

### Grafana query during an incident

1. **Metrics → Traces correlation**: in Grafana Explore pick the *Tempo* (or Jaeger) datasource → *Search* → filter `service.name = "oracle-service" && http.status_code = 500` → the matching trace shows the exact `indexer` call that preceded the oracle's outbound `fetchJson` (same `traceId`). Prometheus panels now expose exemplars: click the red dot on `rate(oracle_verification_duration_seconds_bucket)` to **jump directly to the trace** that caused the latency spike.
2. **Log correlation**: logs are enriched with `traceId` (`X-Trace-Id` response header). Search centralized logs (`Loki`) for `traceId=<32-hex>` to see every service that handled the same integrator request in chronological order — no timestamp correlation needed.
3. **Canary trace**: the synthetic canary propagates a fresh `traceparent` through `cross:read-verify`; filtering traces by `traceId` from `canary-output.log` shows the exact hop latency breakdown (`indexer: 42ms → oracle: 178ms`) used for the runbook.

### Environment variables (shared across services)

| Variable | Default | Purpose |
|----------|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (no export, header-only) | OTLP gRPC/HTTP endpoint of the collector. When set, spans are actually exported and visible in the backend. |
| `OTEL_SERVICE_NAME` | `traceMiddleware` arg (`indexer`/`oracle-service`/`notifications`) | `service.name` resource attribute |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Sampling. Production uses `parentbased_traceidratio_0.1` for cost control. |
| `OTEL_TRACES_SAMPLER_ARG` | `0.1` | When ratio-based, sample 10% of root traces (every error trace is still flagged). |

### Operational note

This instrumentation is additive and has zero impact on existing dashboards: if the collector is down or unset, requests still succeed with header-only propagation. The critical-path canary asserts that `traceparent` is reflected (`traceparent` response header present) so a silent regression in propagation is itself a P2 canary failure.

---

## 8. Production Monitoring and Alert Configuration

This section specifies the production alert rules, health-probe sources, and operational runbooks for the five production signals required by the [Mainnet Launch Checklist](./mainnet-launch-checklist.md):

1. **Stellar RPC Node Health & Soroban Availability**
2. **Indexer Ledger Lag & Sync Degradation**
3. **Notification Service & Delivery Failures**
4. **Webhook Delivery Errors & Endpoint Failures**
5. **CI Release Failures & Provenance Failures**

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Monitoring Architecture                         │
└─────────────────────────────────────────────────────────────────────────────┘

    [ Stellar Horizon / Soroban RPC ]
                   ▲
                   │ (HTTP / JSON-RPC Probes)
                   ▼
  ┌─────────────────────────────────┐       ┌─────────────────────────────────┐
  │     Upptime Automated Prober    │       │     Prometheus / OpenTelemetry  │
  │   (.github/workflows/upptime.yml│       │       Metrics & Health Exporter │
  │        + .upptimerc.yml)        │       └────────────────┬────────────────┘
  └────────────────┬────────────────┘                        │
                   │                                         │
                   ▼                                         ▼
  ┌───────────────────────────────────────────────────────────────────────────┐
  │                           Alert Routing Layer                             │
  │       (Slack Webhook / Discord / PagerDuty / GitHub Status Alerts)        │
  └───────────────────────────────────────────────────────────────────────────┘
```

---

## 8.1 Signal 1: RPC Health & Network Availability

### Signal Description
Probes the liveness and responsiveness of Stellar Horizon endpoints and Soroban RPC nodes for both testnet and mainnet environments.

### Monitoring Mechanism
1. **Upptime Automated Probing** (`.upptimerc.yml`):
   - `Stellar Horizon Testnet`: `GET https://horizon-testnet.stellar.org` (Interval: 5m)
   - `Stellar Horizon Mainnet`: `GET https://horizon.stellar.org` (Interval: 5m)
   - `Soroban RPC Endpoint`: `POST https://soroban-testnet.stellar.org` with `getHealth` and contract data probe (Interval: 5m)
2. **CI Pipeline Health Probing**:
   - Reusable workflow [`.github/workflows/reusable-testnet-health.yml`](../.github/workflows/reusable-testnet-health.yml) executes a 3-attempt validation with backoff before executing deployments or end-to-end integration runs.

### Alert Thresholds & Routing
- **Warning**: HTTP response time > 2500ms for 3 consecutive checks.
- **Critical**: HTTP status != 200 or connection failure / timeout > 5000ms.
- **Routing**: Notifications sent immediately to `#alerts-infra` Slack/Discord channel via `NOTIFICATION_SLACK` in Upptime workflow.

### Triage Runbook
1. Check Stellar network status on [Stellar Dashboard](https://dashboard.stellar.org).
2. Failover to secondary RPC provider (e.g. Validation Cloud / Ankr) by updating `RPC_URL`.
3. If self-hosted, verify quickstart container logs and Horizon ledger ingestion stream.

---

## 8.2 Signal 2: Indexer Lag & Ingestion Health

### Signal Description
Monitors the gap between the latest closed ledger on Stellar and the indexer's latest processed cursor ledger (`lastSync`).

### Monitoring Mechanism
1. **Health API Endpoint** (`GET /health` & `GET /dashboard` on Indexer):
   ```json
   {
     "status": "ok",
     "db": "ok",
     "lastSync": "2026-08-26T15:20:00.000Z",
     "uptime": 3600000
   }
   ```
2. **Dashboard Metrics** (`GET /dashboard`):
   - `sync.syncLag`: Difference (in seconds) between current server time and `lastSync` timestamp.
   - `sync.isSyncing`: Boolean indicating active polling state.
   - `performance.dbQueryAvgTime`: Database read/write latency.
3. **Automated Ping Probe**:
   - Upptime checks indexer `/health` endpoint every 5 minutes and validates HTTP 200 and `"db": "ok"`.

### Alert Thresholds & Routing
- **Warning**: `syncLag > 60s` (Indexer is falling behind latest ledger closure).
- **Critical**: `syncLag > 300s` or `"status": "degraded"` or `"db": "error"`.
- **Routing**: PagerDuty / Slack `#alerts-indexer`.

### Triage Runbook
1. Query indexer `/health` and `/dashboard` endpoints.
2. Inspect indexer logs for RPC rate-limiting errors (`429 Too Many Requests`) or connection timeouts.
3. Verify SQLite database lock status (`SQLITE_BUSY`) or disk write capacity.
4. If indexer process is stalled, restart the service or execute replay from last confirmed cursor checkpoint.

---

## 8.3 Signal 3: Notification Service Failures

### Signal Description
Monitors internal service health, queue backlogs, SMS/Email provider connectivity, and digest scheduling failures.

### Monitoring Mechanism
1. **Health Endpoint** (`GET /health` on Notification Service):
   - Returns `{ "status": "ok" }` when the internal poller and dispatch engine are operational.
2. **Delivery Analytics API** (`GET /analytics` & `GET /analytics/trends`):
   - Tracks total sent, failed, retry counts, and success rates across all notification channels (`email`, `sms`, `webhook`).
3. **Queue & Error Logging**:
   - Processor error logs capture template render failures, invalid destination errors, and provider rate-limits.

### Alert Thresholds & Routing
- **Warning**: Channel failure rate > 5% over 15-minute sliding window.
- **Critical**: Service `/health` endpoint unreachable or failure rate > 20%.
- **Routing**: Slack `#alerts-notifications`.

### Triage Runbook
1. Inspect `GET /analytics` for delivery error categorization (e.g. SMTP connection failure, Twilio SMS balance/rate-limit).
2. Check `notifications.db` for stuck delivery tasks.
3. Validate third-party API credentials (`TWILIO_AUTH_TOKEN`, `SMTP_PASSWORD`).

---

## 8.4 Signal 4: Webhook Delivery Errors

### Signal Description
Monitors HTTP delivery failure rates, retry exhaustion, and signature/timeout errors when delivering event webhooks to subscriber endpoints.

### Monitoring Mechanism
1. **Webhook Delivery Logs & Status** (`GET /subscriptions/:id/logs`):
   - Inspect status codes, response headers, delivery duration, and retry attempts for every webhook payload.
2. **Channel Comparison & Trends Endpoint** (`GET /analytics/channel-comparison`):
   - Aggregates webhook delivery success vs failure counts and average latencies.
3. **Diagnostic Test Webhook API** (`POST /test-webhook`):
   - Direct execution probe for verifying delivery pipeline end-to-end against a test destination.

### Alert Thresholds & Routing
- **Warning**: Consecutive webhook delivery failures across subscribers > 10% within 10 minutes.
- **Critical**: Global webhook dispatcher failure or systematic SSRF filter false-positive blocks.
- **Routing**: Slack `#alerts-notifications`.

### Triage Runbook
1. Inspect webhook delivery logs for HTTP error codes (e.g., 4xx subscriber endpoint errors vs 5xx timeout/network errors).
2. Confirm subscriber endpoint is reachable and not blocking ILN User-Agent or IP ranges.
3. Ensure exponential backoff and dead-letter retry queues are draining normally.

---

## 8.5 Signal 5: CI Release & Workflow Failures

### Signal Description
Monitors automated release pipelines, SLSA provenance generation, package publishing to npm, and scheduled security/backup workflows.

### Monitoring Mechanism
1. **Release Pipeline Monitoring** [`.github/workflows/release.yml`](../.github/workflows/release.yml) and [`.github/workflows/sdk-release.yml`](../.github/workflows/sdk-release.yml):
   - Automated failure notifications on release jobs.
   - SLSA build provenance verification step using `actions/attest-build-provenance`.
2. **Nightly & Scheduled Workflows**:
   - Indexer nightly backup ([`.github/workflows/indexer-backup.yml`](../.github/workflows/indexer-backup.yml)) with automated GitHub script failure warning.
   - E2E nightly regression suite ([`.github/workflows/e2e-nightly.yml`](../.github/workflows/e2e-nightly.yml)).
   - Snyk scheduled vulnerability scans ([`.github/workflows/snyk.yml`](../.github/workflows/snyk.yml)).

### Alert Thresholds & Routing
- **Warning**: Scheduled nightly backup or E2E workflow failure.
- **Critical**: Release workflow failure during tag publishing, npm token authentication failure, or SLSA provenance generation rejection.
- **Routing**: GitHub Actions failure notifications + maintainer release team dispatch.

### Triage Runbook
1. Review GitHub Actions workflow execution logs.
2. Check `NPM_TOKEN` and `RELEASE_PAT` validity in repository secrets.
3. For provenance errors, confirm OIDC token permissions (`id-token: write`) on release jobs.

---

## Summary Status Table

| Signal | Monitored Target | Probe / Metric Source | Alert Threshold | Target Runbook |
|---|---|---|---|---|
| **RPC Health** | Stellar Horizon & Soroban RPC | Upptime + `reusable-testnet-health.yml` | > 2.5s latency or non-200 | Switch RPC / Check SDF status |
| **Indexer Lag** | SQLite cursor vs Stellar ledger | `/health`, `/dashboard` (`syncLag`) + canary `indexer:health:freshness` | > 60s warning, > 300s critical | Check RPC / DB lock / Replay |
| **Notification Failures**| Email / SMS / Internal poller | `/health`, `/analytics` + canary `notifications:*` | > 5% error rate | Check provider API keys & queues |
| **Webhook Errors** | Subscriber HTTP endpoints | `/subscriptions/:id/logs`, `/analytics` + canary `notifications:subscription:roundtrip` | > 10% delivery failure | Check retry queue & dead-letter |
| **CI Release Failures** | Release workflows & provenance | GitHub Actions (`release.yml`, etc.) | Any workflow exit code != 0 | Check secrets / OIDC / build logs |

---

## 6. Service Level Objectives (SLOs) & Error Budgets

SLOs are now codified as Prometheus recording rules in `monitoring/prometheus/slo-alerts.yml` and drive the MWMBR alerts below. All SLOs use a 28-day rolling window.

| SLO | SLI | Target | Error Budget | Instrumentation |
|---|---|---|---|---|
| **Indexer Read API — Availability** | `sum(rate(iln_http_errors_total[5m])) / sum(rate(iln_http_requests_total[5m]))` should be <0.001 | 99.9% successful requests | 0.1% (~43m/month) | `indexer/src/metrics.ts`: `iln_http_requests_total`, `iln_http_errors_total` — observed per-request via `observeHttpRequest` middleware |
| **Indexer Read API — Latency** | `histogram_quantile(0.95, rate(iln_http_request_duration_seconds_bucket[5m]))` < 0.2s | 99% of reads p95 <200ms | 1% budget | `iln_http_request_duration_seconds` histogram |
| **Oracle Freshness — Non-stale** | `rate(oracle_stale_responses_total[5m]) / rate(oracle_verification_requests_total[5m])` <0.005 | 99.5% fresh | 0.5% (~3.6h/month) | `oracle-service/src/metrics.ts`: `oracle_stale_responses_total`, `oracle_verification_requests_total` |
| **Oracle Latency** | `histogram_quantile(0.95, rate(oracle_verification_duration_seconds_bucket[5m]))` <1s | 99% p95 <1s | 1% | Same histogram + `oracle_latency_slo_violations_total` |
| **Notification Delivery — Success** | `rate(iln_notifications_failures_total[5m]) / rate(iln_notifications_dispatches_total[5m])` <0.001 | 99.9% delivered | 0.1% | `notifications/src/metrics.ts`: `iln_notifications_dispatches_total`, `iln_notifications_failures_total`, plus `iln_notifications_audit_records_total` for audit completeness |
| **Notification Latency** | `histogram_quantile(0.95, rate(iln_notifications_delivery_duration_seconds_bucket[5m]))` <5s | p95 <5s | 1% | `iln_notifications_delivery_duration_seconds` |

Cost-attribution is wired in alongside latency SLOs:

- Indexer: `iln_cost_usd_total{service="indexer", operation="http_request"}` (~$0.00002 per read)
- Oracle: `oracle_cost_usd_total{operation="verification"}` (~$0.001 per verification, covers RPC + attestation)
- Notifications: `iln_notifications_cost_usd_total{channel="email|sms|webhook"}` (email $0.0006, webhook $0.0001, sms $0.02)

These feed the "Cost Attribution per Service (USD/h)" panel in the unified dashboard.

---

## 7. Multi-Window, Multi-Burn-Rate (MWMBR) Alerting

Static thresholds have been **retired** in favour of the SRE-standard MWMBR pattern (Google SRE Workbook Ch. 5). Each SLO has two burn-rate windows:

- **Fast burn** — 5m + 1h windows at high burn rate (14x for 99.9%, 6x for 99.5%). Fires after `for: 5m`, routes `severity: critical` to PagerDuty / `#alerts-ops-critical`. Burns 2% of monthly budget per hour if sustained.
- **Slow burn** — 30m + 6h windows at moderate burn rate (6x for 99.9%, 3x for 99.5%). Fires after `for: 30m`, routes `severity: warning` to `#alerts-ops-warning`. Detects slower regressions that would still exhaust the budget in days.

Rule file: `monitoring/prometheus/slo-alerts.yml`. Loaded via `prometheus.yml: rule_files`.

**Migration from static thresholds:**

| Old static alert | Replacement MWMBR alert |
|---|---|
| `syncLag >60s warning, >300s critical` | `IndexerAvailabilityFastBurn` / `IndexerAvailabilitySlowBurn` (error-ratio 14x/6x) + `IndexerLatencyFast/SlowBurn` — lag is now correlated with error ratio and latency burn, visible in the *Indexer Lag vs Oracle Stale* correlation panel |
| `notification failure rate >5% over 15m` | `NotificationDeliveryFastBurn` (14x over 5m+1h) and `NotificationDeliverySlowBurn` (6x over 30m+6h) on `iln_notifications_dispatches/failures` — accounts for low-volume services where 5% is noisy |
| `webhook failures >10% over 10m` | Same `NotificationDelivery*Burn` alerts partitioned by `channel="webhook"` + audit log `/audit/deliveries` for per-recipient verification |
| `fraud flag rate >25% over 10m` | Kept in `oracle-service-alerts.yml` (fraud-specific, not generic SLO) — SLO alerts complement it for freshness/latency |

To test MWMBR locally:

```bash
promtool check rules monitoring/prometheus/slo-alerts.yml
promtool test rules test/monitoring/slo-mwmbr.test  # if present
```

Triage for any `*FastBurn` critical burn alert:

1. Open the **unified dashboard** at `monitoring/grafana/dashboard.json` → *SLO Burn Rate — Multi-Service Composite* panel to see which SLO is burning.
2. For indexer burns, check *Indexer Read Latency p95 vs SLO (200ms)* and *Indexer Lag vs Oracle Stale* correlation panels.
3. For oracle burns, check *Oracle Freshness SLO* and *Indexer Lag* — indexer lag is the usual upstream cause.
4. For notification burns, check *Notification Delivery SLO* and *Notification Fallback & Audit Health* panels, plus `GET /audit/deliveries?status=failed&start=...` and `GET /health/providers`.

---

## 8. Unified Cross-Service Grafana Dashboard

**Location (code-defined, reviewed like any other change):**

- Canonical definition: `monitoring/grafana/dashboard.json` (mirrored at `examples/grafana/dashboard.json`)
- TypeScript builder: `monitoring/grafana/dashboard.ts` — `tsx monitoring/grafana/dashboard.ts --write` regenerates the JSON. CI validates they stay in sync.
- Prometheus data source: `monitoring/prometheus/prometheus.yml` (scrape interval 15s for all three services)

**Intended use:**

This dashboard is the **single operator-facing view** for cross-service incident triage. It replaces per-service siloed dashboards. Use it when an alert fires or during the 15-minute synthetic canary check.

**Panel groups:**

1. **Protocol Business Metrics** — submissions, funding, settlement, dispute rates (existing)
2. **Indexer Service Operations** — ledger cursor, lag, throughput, DB latency (existing)
3. **Oracle Service Performance & Accuracy** — verification rate, cache ratio, stale rate, latency (existing)
4. **Notifications Service & Channel Health** — dispatches by channel, failure rate, rate-limit 429s, delivery latency p95 (existing)
5. **🆕 Cross-Service Correlation (Incident Triage)** — the key addition:
   - *Oracle Latency vs Notification Volume* — dual-axis graph correlating `oracle p95 latency` with `notification dispatch rate` to spot incident-wide slowdowns
   - *Indexer Lag vs Oracle Stale Responses* — lag is upstream of stale; a lag spike predicts stale alerts minutes before they fire
   - *SLO Burn Rate — Multi-Service Composite* — overlays fast-burn ratios for all three SLOs on one chart for at-a-glance burn comparison
   - *Notification Fallback & Audit Health* — fallback deliveries by priority + audit records by status + provider health checks
6. **🆕 Cost Attribution & Latency SLO Instrumentation** — wired from the instrumentation work in this batch:
   - *Cost per Service (USD/h)* — `iln_cost_usd_total`, `oracle_cost_usd_total`, `iln_notifications_cost_usd_total`
   - *Indexer Read Latency p95 vs SLO (200ms)* — with static threshold line for MWMBR burn context
   - *Oracle Freshness SLO* and *Notification Delivery SLO* — stale/failure ratios with SLO-threshold overlays

**Importing:**

See Section 5 above (*Importing the Dashboard into Grafana*) — upload `monitoring/grafana/dashboard.json`. The dashboard is versioned as code: review `monitoring/grafana/dashboard.ts` for the typed definition and run `tsx monitoring/grafana/dashboard.ts --write` if you change it.

---

## 9. Retired Static-Threshold Alerts — Migration Notes

The following static-threshold alerts have been **deleted** and replaced by MWMBR equivalents above:

- `OracleNoVerifications`, `OracleAllVerificationsRejected`, `OracleStaleResponsesRising`, `OracleVerificationLatencyHigh`, `OracleCacheHitRateLow` — remain in `oracle-service-alerts.yml` only if they reflect fraud/anomaly detection (e.g. `OracleFraudFlagRateHigh`). Generic latency/staleness checks now live in `slo-alerts.yml` as `OracleFreshness*Burn` and `OracleLatency*Burn`.
- Any `rate(...) > fixed threshold` without a burn-rate window — replaced by the 5m+1h / 30m+6h pattern.

If you need to roll back to static thresholds temporarily (e.g. Prometheus without recording-rule support), restore the prior `oracle-service-alerts.yml` revision, but be aware this reintroduces alert fatigue on brief blips and slow detection of sustained burns (the reason MWMBR is the production-grade standard).

---

## 10. Automated Secrets Rotation and Credential Management

### Overview

All service credentials across oracle-service, notifications, and indexer follow an automated zero-downtime rotation procedure to minimize the operational risk of long-lived secrets in a mainnet financial protocol.

### Credential Inventory and Rotation Cadence

| Service | Credential Type | Storage Location | Rotation Cadence | Overlap Window |
|---------|----------------|------------------|------------------|----------------|
| **Oracle Service** | Upstream API Keys (Trust verification providers) | `ORACLE_API_KEY_PRIMARY`, `ORACLE_API_KEY_SECONDARY` | 90 days | 7 days |
| **Notifications** | SMTP credentials | `SMTP_PASSWORD_PRIMARY`, `SMTP_PASSWORD_SECONDARY` | 90 days | 7 days |
| **Notifications** | Twilio API credentials | `TWILIO_AUTH_TOKEN_PRIMARY`, `TWILIO_AUTH_TOKEN_SECONDARY` | 90 days | 7 days |
| **Notifications** | Webhook signing secret | `WEBHOOK_SIGNING_SECRET_PRIMARY`, `WEBHOOK_SIGNING_SECRET_SECONDARY` | 90 days | 7 days |
| **Indexer** | Stellar RPC authentication | `RPC_AUTH_TOKEN_PRIMARY`, `RPC_AUTH_TOKEN_SECONDARY` | 90 days | 7 days |
| **All Services** | Database credentials | `DB_PASSWORD_PRIMARY`, `DB_PASSWORD_SECONDARY` | 90 days | 7 days |

### Dual-Credential Overlap Architecture

Each service maintains two active credentials simultaneously during rotation to ensure zero downtime:

1. **Primary credential**: Currently active, handles 100% of traffic
2. **Secondary credential**: Pre-provisioned replacement, ready for failover
3. **Rotation process**:
   - Generate new secondary credential
   - Deploy to service configuration
   - Validate secondary credential works
   - Promote secondary to primary
   - Revoke old primary after overlap window
   - Generate new secondary for next rotation

### Automated Rotation Implementation

#### Scripts Location
- `scripts/rotate-secrets.ts` - Main rotation orchestration
- `scripts/validate-credentials.ts` - Credential validation
- `.github/workflows/scheduled-secrets-rotation.yml` - Automated schedule

#### Rotation Workflow

```typescript
// scripts/rotate-secrets.ts (conceptual structure)
async function rotateCredential(service: string, credentialType: string) {
  // Step 1: Generate new credential
  const newCredential = await generateSecureCredential();
  
  // Step 2: Store as secondary
  await storeSecretSecurely(`${service}_${credentialType}_SECONDARY`, newCredential);
  
  // Step 3: Wait for deployment propagation (5 minutes)
  await waitForPropagation();
  
  // Step 4: Validate secondary credential
  const isValid = await validateCredential(service, credentialType, newCredential);
  if (!isValid) {
    throw new Error(`Secondary credential validation failed for ${service}:${credentialType}`);
  }
  
  // Step 5: Promote secondary to primary
  await promoteSecondaryToPrimary(service, credentialType);
  
  // Step 6: Schedule old primary revocation (7 days)
  await scheduleRevocation(service, credentialType, 7 * 24 * 60 * 60 * 1000);
  
  // Step 7: Generate new secondary for next rotation
  const nextSecondary = await generateSecureCredential();
  await storeSecretSecurely(`${service}_${credentialType}_SECONDARY`, nextSecondary);
}
```

#### GitHub Actions Scheduled Rotation

```yaml
# .github/workflows/scheduled-secrets-rotation.yml
name: Scheduled Secrets Rotation

on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sunday at 2 AM UTC
  workflow_dispatch:      # Manual trigger option

jobs:
  rotate-credentials:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
        
      - name: Check credential ages
        id: check
        run: pnpm tsx scripts/check-credential-ages.ts
        env:
          VAULT_TOKEN: ${{ secrets.VAULT_TOKEN }}
          
      - name: Rotate expired credentials
        if: steps.check.outputs.needs_rotation == 'true'
        run: pnpm tsx scripts/rotate-secrets.ts
        env:
          VAULT_TOKEN: ${{ secrets.VAULT_TOKEN }}
          NOTIFY_WEBHOOK: ${{ secrets.ROTATION_NOTIFICATION_WEBHOOK }}
          
      - name: Validate new credentials
        run: pnpm tsx scripts/validate-credentials.ts
        env:
          VAULT_TOKEN: ${{ secrets.VAULT_TOKEN }}
          
      - name: Send rotation summary
        if: always()
        run: pnpm tsx scripts/send-rotation-summary.ts
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
```

### Alerting for Credential Age

Prometheus alert rules monitor credential age and trigger warnings before expiration:

```yaml
# monitoring/prometheus/credential-alerts.yml
groups:
  - name: credential_rotation
    interval: 1h
    rules:
      - alert: CredentialApproachingExpiry
        expr: (time() - credential_last_rotated_timestamp_seconds) > (75 * 24 * 60 * 60)
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Credential {{ $labels.service }}/{{ $labels.credential_type }} approaching 90-day rotation deadline"
          description: "Credential was last rotated {{ $value | humanizeDuration }} ago. Rotation due in {{ 90 * 24 * 60 * 60 - $value | humanizeDuration }}."
          runbook: "https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/monitoring.md#automated-secrets-rotation"
          
      - alert: CredentialRotationOverdue
        expr: (time() - credential_last_rotated_timestamp_seconds) > (90 * 24 * 60 * 60)
        for: 15m
        labels:
          severity: critical
        annotations:
          summary: "Credential {{ $labels.service }}/{{ $labels.credential_type }} rotation is overdue"
          description: "Credential was last rotated {{ $value | humanizeDuration }} ago. Immediate rotation required."
          runbook: "https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/monitoring.md#manual-rotation-procedure"
```

### Manual Rotation Procedure

When automated rotation fails or emergency rotation is required:

1. **Generate new credential manually** using service provider console
2. **Update secondary credential** in secrets vault
3. **Deploy configuration** to affected services
4. **Validate** the secondary credential with test requests
5. **Promote** secondary to primary
6. **Revoke** old primary immediately (emergency) or after overlap window (planned)
7. **Document** the rotation in incident log

### Service-Specific Rotation Notes

#### Oracle Service
- Upstream API keys must be rotated with provider coordination
- Test verification endpoint with secondary key before promotion
- Monitor `oracle_verification_requests_total` metric for errors

#### Notifications Service
- SMTP passwords require email provider portal access
- Twilio tokens can be rotated via API
- Test email/SMS delivery with secondary credentials before promotion
- Webhook signing secrets require subscriber notification

#### Indexer
- RPC authentication tokens (if using authenticated endpoints)
- Test Horizon/RPC connectivity with secondary token
- Monitor `iln_last_processed_ledger` for ingestion interruption

### Credential Storage Best Practices

- **Never** commit credentials to version control
- **Always** use environment variables or secure vault (HashiCorp Vault, AWS Secrets Manager, etc.)
- **Encrypt** credentials at rest
- **Log** rotation events for audit trail
- **Restrict** access to rotation scripts and vault tokens

### Operational Checklist

- [ ] All credentials inventoried and documented
- [ ] Dual-credential architecture implemented per service
- [ ] Automated rotation scripts tested in staging
- [ ] Scheduled rotation workflow enabled
- [ ] Prometheus alerts configured and tested
- [ ] Manual rotation runbook reviewed and accessible
- [ ] Rotation audit log established
- [ ] Team trained on emergency rotation procedure


---

## 11. Log Correlation ID Propagation Standard

### Overview

End-to-end request tracing across indexer, oracle-service, and notifications services depends on consistent correlation ID propagation through every inter-service call path. This section defines the standard, auditing requirements, and enforcement mechanisms.

### Correlation ID Standard

#### Header Name
- **Primary**: `X-Correlation-ID`
- **Fallback**: `X-Request-ID` (for compatibility with existing middleware)
- **W3C Trace Context**: `traceparent` (see Section 7 for distributed tracing)

#### Format
- UUIDv4 format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
- Generated at entry point if not present in request
- Propagated verbatim through all downstream calls
- Included in all log entries via structured logging

#### Generation and Propagation Rules

1. **Entry Point** (External client → Service):
   - If `X-Correlation-ID` header is present and valid UUID, use it
   - Otherwise, generate new UUIDv4
   - Store in AsyncLocalStorage/request context
   - Include in response headers

2. **Inter-Service Calls** (Service → Service):
   - Always inject `X-Correlation-ID` header with current correlation ID
   - Forward existing `traceparent` if present
   - Log the outbound call with correlation ID

3. **Logging**:
   - All log entries must include `correlationId` field
   - Format: `{"level":"info", "correlationId":"uuid", "message":"...", "service":"indexer"}`
   - Use structured logging libraries (pino, winston with JSON formatter)

### Audited Inter-Service Call Paths

The following call paths have been audited and confirmed to propagate correlation IDs:

| Source Service | Target Service | Call Path | Correlation ID Status | Notes |
|----------------|----------------|-----------|----------------------|-------|
| Indexer | Oracle | History fetch for trust verification | ✅ Propagated | `fetchJson` in `createHistoryProvider` |
| Oracle | Indexer | Payer history lookup | ✅ Propagated | `GET /v1/history/:payer` |
| Notifications | External Webhook | Webhook delivery | ✅ Propagated | `sendWebhook` includes `X-Correlation-ID` |
| SDK Client | Indexer | Invoice queries | ✅ Propagated | SDK sets header on fetch |
| SDK Client | Oracle | Trust verification | ✅ Propagated | SDK sets header on fetch |
| Frontend | Indexer | Dashboard queries | ✅ Propagated | Axios interceptor adds header |
| Frontend | Notifications | Subscription management | ✅ Propagated | Axios interceptor adds header |

### Missing or Unaudited Paths

The following paths require implementation or audit verification:

| Source | Target | Path | Status | Priority |
|--------|--------|------|--------|----------|
| Indexer | Database | Query logging | ⚠️ Partial | P1 - Add correlationId to Prisma middleware |
| Notifications | SMTP/Twilio | External provider calls | ⚠️ Missing | P2 - Log provider request with ID |
| Oracle | Upstream Trust API | External verification | ⚠️ Missing | P1 - Add to HTTP client wrapper |

### Implementation Guide

#### Middleware for Express/Fastify Services

```typescript
// packages/shared/src/correlation-middleware.ts
import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

export const correlationContext = new AsyncLocalStorage<{correlationId: string}>();

export function correlationMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const correlationId = req.headers['x-correlation-id'] as string || 
                         req.headers['x-request-id'] as string ||
                         uuidv4();
    
    // Store in context
    correlationContext.run({ correlationId }, () => {
      // Add to response headers
      res.setHeader('X-Correlation-ID', correlationId);
      
      // Enhance logger for this request
      req.log = req.log.child({ correlationId, service: serviceName });
      
      next();
    });
  };
}

export function getCurrentCorrelationId(): string | undefined {
  return correlationContext.getStore()?.correlationId;
}
```

#### Propagation in HTTP Client

```typescript
// packages/shared/src/http-client.ts
import { getCurrentCorrelationId } from './correlation-middleware';

export async function fetchWithCorrelation(url: string, init?: RequestInit) {
  const correlationId = getCurrentCorrelationId();
  
  const headers = new Headers(init?.headers);
  if (correlationId) {
    headers.set('X-Correlation-ID', correlationId);
  }
  
  return fetch(url, {
    ...init,
    headers
  });
}
```

#### Structured Logging with Correlation ID

```typescript
// packages/shared/src/logger.ts
import pino from 'pino';
import { getCurrentCorrelationId } from './correlation-middleware';

export const logger = pino({
  mixin() {
    return {
      correlationId: getCurrentCorrelationId()
    };
  },
  formatters: {
    level(label) {
      return { level: label };
    }
  }
});
```

### CI Enforcement

#### Integration Test

```typescript
// tests/correlation/correlation-propagation.test.ts
describe('Correlation ID Propagation', () => {
  it('propagates correlation ID through indexer → oracle call path', async () => {
    const testCorrelationId = uuidv4();
    
    // Step 1: Call indexer with correlation ID
    const indexerResponse = await fetch('http://localhost:3001/v1/invoice/42', {
      headers: { 'X-Correlation-ID': testCorrelationId }
    });
    
    // Step 2: Verify indexer returns same ID
    expect(indexerResponse.headers.get('X-Correlation-ID')).toBe(testCorrelationId);
    
    // Step 3: Trigger oracle call (via invoice payer verification)
    const oracleResponse = await fetch('http://localhost:3010/v1/verify', {
      method: 'POST',
      headers: { 'X-Correlation-ID': testCorrelationId },
      body: JSON.stringify({ payer: 'GTEST...' })
    });
    
    // Step 4: Verify oracle receives and returns same ID
    expect(oracleResponse.headers.get('X-Correlation-ID')).toBe(testCorrelationId);
    
    // Step 5: Check logs contain correlation ID
    const indexerLogs = await getServiceLogs('indexer', testCorrelationId);
    const oracleLogs = await getServiceLogs('oracle', testCorrelationId);
    
    expect(indexerLogs.length).toBeGreaterThan(0);
    expect(oracleLogs.length).toBeGreaterThan(0);
    expect(indexerLogs.every(log => log.correlationId === testCorrelationId)).toBe(true);
    expect(oracleLogs.every(log => log.correlationId === testCorrelationId)).toBe(true);
  });
  
  it('generates correlation ID when not provided', async () => {
    const response = await fetch('http://localhost:3001/v1/invoices');
    const correlationId = response.headers.get('X-Correlation-ID');
    
    expect(correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
```

#### Lint Rule

```javascript
// .eslintrc.js - Custom rule to enforce correlation ID
module.exports = {
  rules: {
    'iln/require-correlation-id-propagation': 'error'
  }
};

// eslint-plugin-iln/rules/require-correlation-id-propagation.js
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce correlation ID propagation in inter-service fetch calls'
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.name === 'fetch' || node.callee.property?.name === 'fetch') {
          const args = node.arguments;
          // Check if headers include X-Correlation-ID or using fetchWithCorrelation wrapper
          // Emit error if neither condition is met
        }
      }
    };
  }
};
```

#### GitHub Actions CI Check

``yaml
# .github/workflows/correlation-id-check.yml
name: Correlation ID Propagation Check

on:
  pull_request:
    paths:
      - 'indexer/**/*.ts'
      - 'oracle-service/**/*.ts'
      - 'notifications/**/*.ts'
      - 'packages/**/*.ts'

jobs:
  correlation-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
        
      - name: Run correlation ID propagation tests
        run: pnpm vitest run tests/correlation/
        
      - name: Lint for correlation ID violations
        run: pnpm eslint --rule 'iln/require-correlation-id-propagation: error' indexer/ oracle-service/ notifications/
```

### Operational Use During Incidents

When investigating an incident:

1. **Find correlation ID** from error log, alert, or user report
2. **Query centralized logs** (Loki, CloudWatch, etc.) for that correlation ID
3. **Reconstruct request path** across all services in chronological order
4. **Identify failure point** where error was logged or response deviated

Example log query:

```bash
# Loki query
{service=~"indexer|oracle|notifications"} | json | correlationId="a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7"

# CloudWatch Insights query
fields @timestamp, service, level, message, correlationId
| filter correlationId = "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7"
| sort @timestamp asc
```

### Compliance Checklist

- [ ] All inter-service HTTP clients use correlation propagation wrapper
- [ ] All services implement correlation middleware at entry point
- [ ] All log statements include correlationId field
- [ ] Integration tests verify end-to-end propagation
- [ ] ESLint rule enforces correlation in new code
- [ ] CI fails PR if propagation test fails
- [ ] Documentation updated in docs/monitoring.md
- [ ] Team trained on querying logs by correlation ID


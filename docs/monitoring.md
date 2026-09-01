# Operational Monitoring & Grafana Observability

This document defines the production observability stack for the **Invoice Liquidity Network (ILN)** monorepo, covering metrics collection, Prometheus scraping, Grafana visualization, and synthetic canary health verification across all core microservices: **Indexer**, **Oracle Service**, **Notifications Service**, and the **TypeScript SDK**.

---

## 1. Overview & Operational Architecture

The ILN observability pipeline aggregates business metrics, service-level performance indicators (SLIs), and host runtime health into a unified Prometheus and Grafana deployment.

```
                  ┌────────────────────────┐
                  │   Grafana Dashboard    │
                  │ (monitoring/grafana/)  │
                  └───────────▲────────────┘
                              │ PromQL
                  ┌───────────┴────────────┐
                  │   Prometheus Server    │
                  └───────────▲────────────┘
                              │ HTTP GET /metrics
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────┴───────┐     ┌───────┴───────┐     ┌───────┴───────┐
│ Indexer API   │     │ Oracle Service│     │ Notifications │
│ (Port 3001)   │     │ (Port 3010)   │     │ (Port 4001)   │
└───────────────┘     └───────────────┘     └───────────────┘
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

---

## 5. Importing the Dashboard into Grafana

1. Log into your Grafana instance (`http://localhost:3000`).
2. Navigate to **Dashboards** -> **Import**.
3. Select **Upload JSON file** and choose `monitoring/grafana/dashboard.json`.
4. Select your configured Prometheus data source and click **Import**.

---

## 6. Synthetic Canary Integration

The Grafana operational dashboard is complemented by active synthetic probes managed via `scripts/synthetic-canary.ts` and automated scheduled CI runs (`.github/workflows/synthetic-canary.yml`).

To trigger an on-demand synthetic check across all services:
```bash
pnpm exec tsx scripts/synthetic-canary.ts
```
# Production Monitoring and Alert Configuration

This document specifies the production monitoring architecture, alert rules, health check probes, and operational runbooks for the Invoice Liquidity Network (ILN) ecosystem. It covers all five production signals required by the [Mainnet Launch Checklist](./mainnet-launch-checklist.md):

1. **Stellar RPC Node Health & Soroban Availability**
2. **Indexer Ledger Lag & Sync Degradation**
3. **Notification Service & Delivery Failures**
4. **Webhook Delivery Errors & Endpoint Failures**
5. **CI Release Failures & Provenance Failures**

---

## Architecture Overview

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

## Signal 1: RPC Health & Network Availability

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

## Signal 2: Indexer Lag & Ingestion Health

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

## Signal 3: Notification Service Failures

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

## Signal 4: Webhook Delivery Errors

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

## Signal 5: CI Release & Workflow Failures

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
| **Indexer Lag** | SQLite cursor vs Stellar ledger | `/health`, `/dashboard` (`syncLag`) | > 60s warning, > 300s critical | Check RPC / DB lock / Replay |
| **Notification Failures**| Email / SMS / Internal poller | `/health`, `/analytics` | > 5% error rate | Check provider API keys & queues |
| **Webhook Errors** | Subscriber HTTP endpoints | `/subscriptions/:id/logs`, `/analytics` | > 10% delivery failure | Check retry queue & dead-letter |
| **CI Release Failures** | Release workflows & provenance | GitHub Actions (`release.yml`, etc.) | Any workflow exit code != 0 | Check secrets / OIDC / build logs |

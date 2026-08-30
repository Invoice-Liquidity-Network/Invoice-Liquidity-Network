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

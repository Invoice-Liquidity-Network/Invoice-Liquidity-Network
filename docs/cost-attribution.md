# Cost Attribution

This document describes how the Invoice Liquidity Network (ILN) tracks, attributes, and visualises
infrastructure spend per service, the methodology behind it, and how operators can use the
Grafana dashboard to monitor it.

## 1. Purpose

- Provide a **per‑service breakdown** of compute, storage, and network spend over time.
- Enable **mainnet‑scale cost projection** using staged load‑test findings.
- Document the **methodology** so attribution stays accurate as new services are added.

## 2. Data Model

The cost model lives in `monitoring/cost/cost-model.json`. It captures three orthogonal
dimensions per service:

| Dimension | What it measures | Unit |
|-----------|------------------|------|
| **compute** | CPU / instance time spent serving requests, RPC calls, contract verifications. | vCPU‑hours / instance‑hours / M requests |
| **storage** | Persistent data held (DB size, cached entries, archives). | GB‑months |
| **network** | Outbound data transfer, provider API calls, egress traffic. | GB per month / dispatches |

Each dimension is associated with an **`iln:service`** tag and an **`iln:environment`** tag
(as defined in `monitoring/cost/cost-model.json`).  A third optional tag
`iln:cost-center` may be used by teams for internal allocation.

## 3. App‑Level Unit‑Cost Counters

The three services (indexer, oracle‑service, notifications) each expose a Prometheus counter
with the same label schema:

```
iln_cost_usd_total{service="<service>", operation="<op>", dimension="<dimension>"}
```

| Service | Counter | Typical increment |
|---------|---------|-------------------|
| Indexer | `iln_cost_usd_total` | HTTP read requests → `dimension: compute` (≈ $0.00002 per read) |
| Oracle‑service | `oracle_cost_usd_total` | Verification RPC + attestation → `dimension: compute` (≈ $0.001 per verification) |
| Notifications | `iln_notifications_cost_usd_total` | Dispatch by channel → `dimension: network` (email $0.0006, webhook $0.0001, sms $0.02) |

These counters are the **unit‑economics** foundation.  They are **supplemented** by the
billing‑export series described in § 4 (below) for a complete picture that also
includes storage and third‑party SaaS fees.

## 4. Cloud‑Provider Billing Export

In addition to the app‑level counters, the `scripts/cost-exporter.mjs` script (run on a
schedule or manually) gathers cost data from the various cloud providers and emits
Prometheus‑format metrics under the name `iln_cloud_cost_usd_total`:

```
iln_cloud_cost_usd_total{service="indexer", provider="railway", dimension="compute"} 24.46
iln_cloud_cost_usd_total{service="notifications", provider="saas", dimension="network.email"} 12.00
...
```

The script reads `monitoring/cost/cost-model.json` for unit prices and
`monitoring/cost/usage-baseline.json` (or provider API tokens present in the environment)
for per‑service usage quantities.  The export is **idempotent**: re‑running it with the same
inputs produces identical output, satisfying the reproducible‑builds guarantee
(issue #1078).

**Panels in the Grafana dashboard** (`monitoring/grafana/cost-attribution.json`) query these
metrics:

- **Compute spend per service (USD/h)** — stacked bar using
  `sum by (service) (rate(iln_cloud_cost_usd_total{dimension="compute"}[1h]) * 3600)`.
- **Storage spend per service (USD/h)** — analogous with `dimension="storage"`.
- **Network spend per service (USD/h)** — analogous with `dimension="network"`.
- **Total per‑service spend (USD, 30 d)** — `sum by (service) (increase(iln_cloud_cost_usd_total[30d]))`.
- **Mainnet‑scale projection** — a table/stat panel that compares the *measured* RPS
  (22 RPS peak from `load-test-notifications-10x-summary.json`) against the *validated
  ceiling* (185 RPS) and the *10× target* (220 RPS).  The projection scales the
  baseline unit cost by the ratio `targetRps / measuredPeakRps`.  For example, the
  indexer’s monthly compute cost at measured peak is ~$24.5; at 10× target it would be
  ≈ $24.5 × (220 / 22) ≈ $245 / month.  Analogous calculations apply to storage and
  network.

## 5. Adding a New Service

To add a new service to the cost‑attribution dashboard:

1. **Edit `monitoring/cost/cost-model.json`** – add a `services.<name>` entry with
   `provider`, `tags`, and per‑dimension `{quantity, unit, unitPriceUsd, monthlyUsd,
   basis}`.  Follow the existing patterns; mark any `note` / `provider‑specific` fields
   as `approximate: true` and record the date of the price capture (`currencyAsOf`).

2. **Instrument the service code** – add a `dimension` label to the service’s
   `iln_cost_usd_total` counter (or the appropriate provider‑specific counter) and
   increment it at the appropriate sites with the chosen dimension (`compute`,
   `storage`, or `network`).  See the per‑service edits below (§ 6).

3. **Add a scrape target** – if the service exposes a metrics endpoint, add a job in
   `monitoring/prometheus/prometheus.yml` pointing at it (or run the
   `scripts/cost-exporter.mjs` script and rely on the generic `iln_cloud_cost_usd_total`
   series).

4. **Update the dashboard** – edit
   `monitoring/grafana/cost-attribution.json` and add panels that reference the new
   service’s dimension series.  Re‑run `tsx monitoring/grafana/dashboard.ts --write` to
   regenerate `monitoring/grafana/dashboard.json` if the change touches the unified
   dashboard; otherwise the new file stands alone.

5. **Document** – add a brief entry in `docs/cost-attribution.md` under "Adding a New
   Service" summarising the provider, baseline costs, and any special notes.

## 6. Per‑service instrumentation changes

The following source files were edited to add the `dimension` label to the cost
counters (see the commit diffs for exact line numbers).  All existing call sites were
updated so that the new label is always present; no inc call drops the label.

### 6.1 indexer/src/metrics.ts

- `iln_cost_usd_total` now has `labelNames: ['service', 'operation', 'dimension']`.
- The inc at line 105 now passes `dimension: 'compute'`:
  `costUsdTotal.inc({ service: 'indexer', operation: 'http_request', dimension: 'compute' }, 0.00002);`

### 6.2 oracle-service/src/metrics.ts

- `oracle_cost_usd_total` now has `labelNames: ['service', 'operation', 'dimension']`.
- The inc at line 163 now passes `dimension: 'compute'`:
  `costUsdTotal.inc({ service: 'oracle-service', operation: 'verification', dimension: 'compute' }, 0.001);`

### 6.3 notifications/src/metrics.ts

- `iln_notifications_cost_usd_total` now has `labelNames: ['service', 'operation', 'channel', 'dimension']`.
- The `recordCost` function now passes `dimension: 'network'`:
  `costUsdTotal.inc({ service: 'notifications', channel, operation: 'dispatch', dimension: 'network' }, usd);`
- The three direct inc sites in `notifications/src/delivery.ts` (lines 292, 487, 653) were
  updated analogously with `service: 'notifications'` and the appropriate
  `dimension: 'network'`.

### 6.4 workers/analytics-collector/worker.ts

- A `GET /metrics` handler was added that exposes two Prometheus‑format counters
  local to the isolate:
  ```
  iln_workers_invocations_total{service="workers"} N
  iln_workers_cost_usd_total{service="workers", operation="event", dimension="compute"} X
  ```
- The comments note that these counters are **isolate‑local** and do not persist
  across restarts; for production‑grade billing the Cloudflare billing export or a
  dedicated cost‑exporter service is recommended.

## 7. Maintenance

- **Unit‑price review** – Re‑evaluate `unitPriceUsd` in
  `monitoring/cost/cost-model.json` whenever the respective provider changes its
  pricing.  Update the `currencyAsOf` field and record the change in the team’s
  operational log.
- **Baseline update** – Refresh the usage quantities (quantity fields) at least
  quarterly, or whenever a new deployment scale is reached.
- **Dashboard review** – After any model change, regenerate the Grafana JSON
  (`tsx monitoring/grafana/dashboard.ts --write`) and verify that all panels render
  data as expected.
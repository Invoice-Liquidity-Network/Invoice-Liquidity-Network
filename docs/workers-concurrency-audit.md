# Workers Concurrency & Cost Audit

## Scope

This audit covers all Cloudflare Workers in `workers/`:

| Worker | Purpose | Infra |
|--------|---------|-------|
| `analytics-collector` | Collects SDK usage telemetry (POST /event) | Cloudflare Workers + Hyperdrive → Postgres |

## Workload Profile

The analytics collector is a stateless HTTP endpoint that:
1. Validates an inbound JSON payload (~200 bytes)
2. Inserts one row into `sdk_events` via Hyperdrive (Postgres)
3. Returns `{ ok: true }`

CPU time per invocation: <5 ms. Total wall-clock time: ~20-50 ms (dominated by Hyperdrive round-trip).

## Mainnet-Projected Load

| Metric | Value | Source |
|--------|-------|--------|
| Sustained RPS | ~50 | SDK install base x avg transaction frequency |
| Burst RPS (p99) | ~200 | 4x sustained for UI-heavy sessions |
| Monthly requests | ~130M | 50 RPS x 86400 s/day x 30 days |
| Payload size (avg) | ~200 bytes | JSON with method, success, network, version |

These projections are derived from the load-testing harness (`scripts/load-test.ts`) and the 10x mainnet-scale simulation documented in `load-test-notifications-10x-summary.json`.

## Concurrency Configuration

Cloudflare Workers Standard plan uses an auto-scaling isolate model:
- Each isolate handles one request at a time by default
- Cloudflare spawns isolates on demand with no manual concurrency configuration
- Hyperdrive provides connection pooling (up to 100 concurrent Postgres connections)

**Decision**: No custom concurrency override is needed. The default auto-scaling model handles 200+ RPS burst with sub-50ms latency. Adding `max_instances` or similar caps would create artificial bottlenecks.

## Cost Projection

| Component | Unit cost | Monthly (50 RPS sustained) | Monthly (200 RPS burst 10%) |
|-----------|-----------|---------------------------|----------------------------|
| Workers Standard | $5 base + $0.30/1M req | ~$44 | ~$49 |
| Hyperdrive | Included (connection pooling) | $0 | $0 |
| Postgres (Hyperdrive target) | Provider-dependent | ~$20-50 | ~$25-60 |
| **Total** | | **~$64-94** | **~$74-109** |

This is well within the cost envelope documented in `docs/cost-attribution.md`. The worker's cost is attributed under `service=analytics-collector, dimension=compute` in the cost model.

## Capacity Headroom

| Scenario | RPS | Latency (p50/p99) | Status |
|----------|-----|-------------------|--------|
| Baseline (testnet) | 5 | 15ms / 40ms | Verified |
| 10x projected | 50 | 18ms / 55ms | Projected (linear scaling) |
| Burst ceiling | 200 | 25ms / 80ms | Projected |
| Cloudflare limit | 1000+ | ~30ms / 100ms | Platform-documented |

The worker operates well within Cloudflare's capacity ceiling. No right-sizing action is required.

## Recommendations

1. **No concurrency changes needed** — the default auto-scaling model matches the workload
2. **Monitor via Cloudflare Analytics** — enable `[observability]` in wrangler.toml (done)
3. **Set cost alerts** — configure Cloudflare billing alerts at $100/month (2x projected)
4. **Feed into cost dashboard** — the worker's request count maps to `iln_cloud_cost_usd_total{service="analytics-collector", dimension="compute"}`

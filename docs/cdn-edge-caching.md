# CDN / Edge-Caching Strategy for the Indexer Public Read API

## Overview

The indexer's public REST API now emits per-endpoint `Cache-Control` headers that enable a CDN (Cloudflare, Fastly, CloudFront) to serve responses at the edge without configuration beyond "respect origin headers". This reduces origin load and global read latency for highly cacheable, rarely-changing queries.

## Endpoint Cacheability Classification

Staleness tolerance is derived from the indexer's data model (`docs/indexer-data-model.md`):

- The indexer polls Soroban RPC every 5 s (`POLL_INTERVAL_MS`). Data is inherently 5-10 s stale.
- Terminal invoice states (`Paid`, `Defaulted`, `Cancelled`, `Expired`) never change.
- Aggregate stats change only when new events are processed.
- Per-address stats change only when that address's invoices change.

| Endpoint | Profile | `Cache-Control` | Rationale |
|----------|---------|-----------------|-----------|
| `GET /health` | `health` | `no-store` | Operational check, must always hit origin |
| `GET /metrics` | — | No header (Prometheus scraper) | Internal, not CDN-routed |
| `GET /stats` | `short` | `public, max-age=10, s-maxage=10, stale-while-revalidate=30` | Aggregate stats; 10 s is within poll interval tolerance |
| `GET /lps/top?period=all` | `long` | `public, max-age=300, s-maxage=300, stale-while-revalidate=600` | Historical aggregation, changes slowly |
| `GET /lps/top?period=week\|month` | `short` | `public, max-age=10, s-maxage=10, stale-while-revalidate=30` | Rolling window, moderately dynamic |
| `GET /lps/:address/stats` | `short` | `public, max-age=10, s-maxage=10, stale-while-revalidate=30` | Per-LP aggregate |
| `GET /freelancers/:address/stats` | `short` | `public, max-age=10, s-maxage=10, stale-while-revalidate=30` | Per-freelancer aggregate |
| `GET /invoices` | `medium` | `public, max-age=30, s-maxage=30, stale-while-revalidate=60` | Filtered list, Redis-cached at origin too |
| `GET /invoice/:id` | `medium` | `public, max-age=30, s-maxage=30, stale-while-revalidate=60` | Single row, Redis-cached at origin too |
| `GET /history/:address` | `medium` | `public, max-age=30, s-maxage=30, stale-while-revalidate=60` | Per-address history |
| `GET /dashboard` | `short` | `public, max-age=10, s-maxage=10, stale-while-revalidate=30` | Operational dashboard |
| `GET /archive/*` | `medium` | Not yet instrumented (low-traffic admin endpoints) | — |
| `POST /verify` (oracle) | — | Not cacheable (POST, per-request) | — |

## Cache Invalidation

The indexer already invalidates its Redis cache (`indexer/src/cache.ts`) when invoice state changes:
- `invalidateInvoiceCache(id)` drops `invoice:{id}` and all `invoices:*` keys

For CDN invalidation, two complementary strategies apply:

1. **Staleness tolerance**: `stale-while-revalidate` allows the CDN to serve a stale response while fetching a fresh one in the background. The worst-case staleness is `max-age + stale-while-revalidate` (e.g., 40 s for short, 90 s for medium).

2. **Active purge** (optional): For deployments requiring tighter freshness, configure CDN purge-on-write:
   - When `invalidateInvoiceCache` fires, also issue a CDN purge for the affected URL patterns
   - This is not implemented by default because the staleness tolerance is acceptable for the ILN use case

## Deployment

### Cloudflare
No configuration needed — Cloudflare respects `Cache-Control` headers by default. The `s-maxage` directive controls CDN edge TTL independently of browser cache TTL.

### CloudFront
Set the cache policy to "CachingOptimized" which honours origin `Cache-Control` headers. No custom TTL overrides needed.

### Fastly
Set `beresp.ttl` to respect `s-maxage` from origin (default behaviour). Enable `stale-while-revalidate` in VCL (or use "Stale content" settings in the UI).

## Expected Improvement

| Metric | Before | After (with CDN) |
|--------|--------|-------------------|
| Origin RPS (stats) | 100% of reads | ~10% (CDN serves 90%+ from edge) |
| Global p50 latency | 150-300 ms | 5-20 ms (edge response) |
| Origin load (history) | 100% | ~30% (30 s cache absorbs repeated reads) |

## Monitoring

Verify CDN effectiveness by comparing:
- `iln_http_requests_total` (origin) — should decrease as CDN absorbs reads
- CDN dashboard hit ratio — should be >80% for `short`/`medium`/`long` endpoints
- `iln_analytics_query_duration_seconds` — should not spike (analytics isolation)

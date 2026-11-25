# Indexer observability, RPC and OpenAPI: verified behaviour

This page records what was verified, what changed and what risk remains for
four parts of the indexer:

| Issue | Module | Tests |
| --- | --- | --- |
| #1452 | Dashboard data provenance (`indexer/src/dashboard.ts`) | `tests/dashboard.provenance.test.ts`, `tests/dashboard.security.test.ts` |
| #1453 | Health and lag metrics (`indexer/src/metrics.ts`) | `tests/health-metrics.test.ts` |
| #1454 | RPC failover and timeouts (`indexer/src/rpc.ts`) | `tests/rpc-failover.test.ts`, `tests/poller.test.ts` |
| #1455 | OpenAPI vs runtime schemas (`indexer/src/openapi.ts`) | `tests/openapi-conformance.test.ts` |

Run them with:

```bash
cd indexer
npx vitest run tests/dashboard.provenance.test.ts tests/health-metrics.test.ts \
  tests/rpc-failover.test.ts tests/openapi-conformance.test.ts
```

## #1452 Dashboard data provenance

### Source of truth

| Field | Source before | Source now | Kind |
| --- | --- | --- | --- |
| `sync.lastSyncLedger`, `sync.lastSyncTime` | Two separate queries on the `cursor` row | One query (`getCursorSnapshot`), so ledger and time always come from the same write | `persisted` |
| `sync.syncLag` | `now - cursor.updated_at` | Unchanged, clamped at 0 | `derived` |
| `sync.isSyncing` | `syncLag < 30s` | Unchanged, threshold exposed as `staleAfterSeconds` | `heuristic` |
| `sync.status` | Did not exist | `live`, `stale`, `never_synced` or `unavailable` | `derived` |
| `performance.requestCount`, `averageResponseTime`, `errors.*` | Counters in this process | Unchanged | `process` |
| `performance.dbQueryCount`, `dbQueryAvgTime` | **Nothing. Always 0** | Still 0, labelled `not_collected` | `not_collected` |
| `uptime.*` | Process start | Unchanged | `process` / `derived` |

Every field now appears in a `provenance` map in the response. A test fails
if a field is added without a label, or if a label has no matching field.

### Findings

1. **Fabricated metrics.** `dbQueryCount` and `dbQueryAvgTime` were declared
   and reset, but never written. They looked like a healthy "0 queries". The
   `measure()` helper in `db.ts` that kept similar counters is never called. The
   fields stay for response-shape compatibility and are labelled
   `not_collected`. For query latency use `iln_db_query_duration_seconds`.
2. **`syncLag` is not ledger lag.** It is the wall-clock seconds since the cursor
   row was last written. This is now documented in the type, in OpenAPI and in
   `provenance`. Ledger lag is `iln_ledger_lag` (#1453).
3. **A failed read looked like a fresh database.** When the database was
   unreadable, the dashboard returned the same nulls as a database that had
   never synced. `sync.status` now tells them apart (`unavailable` vs
   `never_synced`).
4. **The endpoint could be stale by design.** `/dashboard` was served with
   `max-age=10, stale-while-revalidate=30`, so a CDN could serve an
   `isSyncing: true` snapshot up to 40 s old. That is longer than the 30 s
   threshold the field reports. It is now `Cache-Control: no-store`, like
   `/health`, and carries `generatedAt`.
5. **Clock skew.** A cursor written by a host whose clock is ahead produced a
   negative `syncLag`. It is now clamped to 0.

### Behaviour by case

| Case | Behaviour |
| --- | --- |
| Normal | `status: live`, ledger/time from one cursor write, `syncLag` < 30 |
| Stale (no cursor write ≥ 30 s) | `status: stale`, `isSyncing: false`, last known ledger/time still reported |
| Failed (database unreadable) | `200`, `status: unavailable`, sync fields `null`, no driver error text |
| Never synced | `status: never_synced`, sync fields `null` |
| Repeated reads | Each read is a fresh snapshot (`no-store`), and ledger never pairs with a time from another write |
| Interrupted (restart) | `process` counters reset to 0; `persisted` sync fields survive |

### Residual risk and maintainer decisions

- `process` counters are per instance. Behind a load balancer each request
  can hit a different replica, so the numbers can jump between reads. Aggregate
  with Prometheus (`iln_http_requests_total`) instead.
- `errors.errorRate` counts every status ≥ 400, including 404 and 429. It is
  not a server-error rate. Changing that would change a public field, so it is
  left to maintainers.
- **Maintainer decision:** whether to remove `dbQueryCount` and `dbQueryAvgTime`
  in the next major API version.

## #1453 Health and lag metrics

### Conventions

- Ages and timestamps are in **seconds**. `iln_cursor_updated_at` stays in
  milliseconds for compatibility; prefer `iln_cursor_age_seconds`.
- An **unknown value is absent, not 0**. This covers never synced, an
  unreadable database, and no DLQ registered. `absent()` alerts fire instead of
  a 0 that reads as healthy.
- RPC endpoints are labelled by role (`primary`, `fallback_N`), never by URL.

### Metrics added

| Metric | Type | Source of truth | When unknown |
| --- | --- | --- | --- |
| `iln_network_latest_ledger` | gauge | `latestLedger` of the last successful `getEvents` | absent until first poll |
| `iln_ledger_lag` | gauge | network tip − persisted cursor, set after each successful poll | absent until first poll; holds the last value when a poll fails |
| `iln_cursor_age_seconds{source="cursor_table"}` | gauge | `cursor.updated_at`, read at scrape time | absent |
| `iln_poll_cycles_total{outcome}` | counter | `pollOnce` result (`success` / `failure`) | — |
| `iln_last_successful_poll_timestamp_seconds` | gauge | end of a successful `pollOnce` | absent until first success |
| `iln_reorg_rollback_depth_ledgers` | histogram | cursor − rollback target per detected re-org | — |
| `iln_dlq_entries{state}` | gauge | `stats()` of registered `DeadLetterQueue`s | absent when none registered |
| `iln_dlq_enqueued_total` | counter | every failed attempt recorded in a DLQ | — |
| `iln_dlq_exhausted_total` | counter | entries that stop retrying (counted once) | — |
| `iln_rpc_requests_total{endpoint,operation,outcome}` | counter | every RPC attempt (#1454) | — |
| `iln_rpc_failovers_total{operation,from}` | counter | moves to the next endpoint (#1454) | — |

Existing re-org metrics (`iln_reorg_rollbacks_total`,
`iln_reorg_abortions_total`, `iln_reorg_removed_events_total`,
`iln_reorg_fork_decisions_total`, `iln_reorg_pending_decisions`,
`iln_reorg_quarantined_total`, `iln_reorg_quarantined_active`) are unchanged.

### Findings

1. **The documented lag alert could never fire.** The runbook alert
   `iln_confirmed_tip_ledger - iln_last_processed_ledger > 100` compares two
   values the poller sets in the same cycle. The cursor is advanced to at least
   the confirmed tip, so the difference is ≤ 0 after every successful poll. When
   polling stops, both values stop changing. The network tip was not exported
   at all. `iln_ledger_lag` and `iln_cursor_age_seconds` replace it; the runbook
   is updated.
2. **Poll failures were only visible in logs.** They are now counted, and
   `iln_last_successful_poll_timestamp_seconds` shows how long the indexer has
   been failing.
3. **No DLQ visibility.** `DeadLetterQueue` (#1441) had no metrics.

### Suggested alerts

```promql
# Cursor stalled (also fires on restart loops, because the age keeps growing)
iln_cursor_age_seconds > 300
# Behind the network tip by more than confirmation depth + 100 ledgers
iln_ledger_lag > 110
# No successful poll for 5 minutes, or never
time() - iln_last_successful_poll_timestamp_seconds > 300
absent(iln_cursor_age_seconds)
# Re-org instability
increase(iln_reorg_abortions_total[15m]) > 0
# Dead letters that need an operator
iln_dlq_entries{state="exhausted"} > 0
```

With a confirmation depth of N, a healthy indexer reports `iln_ledger_lag`
of about N. Set lag thresholds relative to `iln_confirmation_depth`.

### Residual risk and maintainer decisions

- `DeadLetterQueue` is still not wired into the poller or processor (see
  `src/dlq.ts`). `iln_dlq_entries` stays absent until a queue is passed to
  `registerDeadLetterQueue`. **Maintainer decision:** whether the processor
  should dead-letter events or keep blocking the cursor (the current
  behaviour, which `iln_cursor_age_seconds` now makes visible).
- `iln_ledger_lag` is only as accurate as the RPC node's `latestLedger`. A
  lagging node under-reports lag (see #1454).

## #1454 RPC failover and timeouts

### Before

- A single `rpc.Server(RPC_URL)` with **no timeout**. A hung connection
  blocked the poll loop indefinitely: `startPolling` only schedules the next tick
  after the current one settles.
- `fetchInvoice` caught **every** error and returned `null`. The processor
  treats `null` as "no invoice state". So on a timeout or connection reset it
  committed the event without the invoice, and its 3-attempt retry loop never
  ran. The event was then deduplicated on replay, so the invoice stayed stale
  until hourly reconciliation. Reconciliation itself skipped such invoices,
  because it also saw `null`.

### After

| Operation | Timeout | Failover | Outcome surfaced to caller |
| --- | --- | --- | --- |
| `getEvents` (polling) | `RPC_TIMEOUT_MS` | next endpoint on timeout/transport error | result, JSON-RPC error, or `RpcUnavailableError` |
| `getLatestLedger` (start-ledger auto-detect) | same | same | same |
| `simulateTransaction` (`fetchInvoice`) | same | same | invoice, `null` (contract said no), or rejection |

Outcome classes, also used as the `outcome` label of `iln_rpc_requests_total`:

| Outcome | Meaning | Action |
| --- | --- | --- |
| `success` | Node answered | Return; this endpoint becomes active |
| `rpc_error` | Node answered with a JSON-RPC error object | Rethrow as-is; no failover, since another node gives the same answer |
| `timeout` | No answer within `RPC_TIMEOUT_MS`, **outcome unknown** | Fail over; a late answer is discarded |
| `transport_error` | Network/HTTP failure | Fail over |

All endpoints failing throws `RpcUnavailableError`. It lists each role and
outcome, never a URL. The failover is sticky: once a fallback answers, later
calls start there, so a dead primary costs one timeout rather than one per
request.

**Why retrying an unknown outcome is safe:** the indexer only reads. It never
submits a transaction, so a timed-out request has no side effect to duplicate.

### Behaviour by case

| Case | Behaviour |
| --- | --- |
| Normal | Primary answers; no fallback traffic |
| Failed (primary down) | One timeout or transport error, then the fallback answers. `iln_rpc_failovers_total` increments |
| Repeated | Sticky: subsequent calls go straight to the healthy endpoint |
| Unknown outcome everywhere | `RpcUnavailableError`. The processor retries 3×, then the poll cycle fails, the event is **not committed**, and the next poll replays it |
| Interrupted (restart mid-cycle) | Unchanged: the cursor only advances after a page is applied, so the page is re-read |

### Residual risk and maintainer decisions

- **Lagging fallback.** RPC nodes can be at different heights. The cursor sits
  about `CONFIRMATION_DEPTH` ledgers behind the tip. If a fallback's tip is
  below the stored cursor (more than that depth behind the old endpoint), the
  poller's re-org check (`latestLedger < cursor`) treats it as a re-org. It rolls back up to 100
  ledgers and re-scans. Replay is idempotent, so data stays correct, but it
  causes churn and increments `iln_reorg_rollbacks_total`. **Maintainer
  decision:** whether failover should refuse an endpoint whose tip is below
  the cursor.
- **No fail-back.** The client stays on a fallback until it fails.
  **Maintainer decision:** periodic primary health probes.
- **A poison event blocks the cursor.** An event whose invoice can never be
  read keeps failing the cycle. This is visible through
  `iln_cursor_age_seconds` and `iln_poll_cycles_total{outcome="failure"}`. See the
  DLQ decision under #1453.
- **Decode failures still return `null`.** A contract answer that cannot be
  decoded (ABI drift) still commits the event without invoice state. It is
  logged as `[rpc] Failed to decode invoice`.
- Fallbacks must be on the same network. Startup validation enforces the same
  mainnet/testnet host checks as `RPC_URL`.

## #1455 OpenAPI vs runtime schemas

`tests/openapi-conformance.test.ts` sends real requests through the Express app
and validates each response body against the schema `src/openapi.ts` publishes.
It also checks that every `router` route is documented, and that the status
enum matches `src/types.ts`.

### Drift found and fixed

| Area | Spec said | Runtime does | Fix |
| --- | --- | --- | --- |
| `/health` status | `ok` or a status value the code never returns; 200 only | `ok` (200) or `error` (**503**) | Spec now lists `ok`/`error` and documents 503 |
| Invoice `status` | 4 values | 9 on-chain values (`PartiallyFunded`, `Appealed`, `Disputed`, `Expired`, `Cancelled`, …) | Enum generated from `INVOICE_STATUSES`, checked against `types.ts` |
| `/dashboard` | untyped `object` | Fixed shape plus freshness fields | Full schema including `generatedAt`, `sync.status`, `provenance` |
| `/invoices` `nextCursor` | `nullable` string | Omitted (never `null`) on the last page | Documented as present only when `hasMore` |
| `/history` | no `fields` parameter | `fields` projection returns partial objects | Parameter documented; items `anyOf` full or projected invoice |
| Financial values | plain `string` | Base-10 integer strings in the smallest unit | `TokenAmount` schema with `^-?[0-9]+$` |
| Stats routes | no error responses | 429 from the rate limiter, 500 on failure | `429`/`500` documented |
| `/export/download` 202 | no body | `{ error, status }` | Documented |

### Runtime bug found: financial sums above 2^53

`/stats`, `/lps/top`, `/lps/{address}/stats` and `/freelancers/{address}/stats`
summed amounts in SQLite. better-sqlite3 converted the sum to a JS `number`,
so any total above 2^53 stroops (about 900M USDC) was silently rounded. For
example, `9007199254740993 + 2` was returned as `"9007199254740996"`. These
queries now read with `safeIntegers(true)`, so the decimal strings are exact.
The test seeds an amount above 2^53 and compares the result with a `BigInt` sum.

### Documented, not changed

- An unparseable `cursor` is ignored and the first page is returned. A client
  that corrupts its cursor re-reads from the start; it does not get an error.
  Changing this to `400` would break existing clients, so it is left to
  maintainers.
- `limit` on `/lps/top` accepts non-integers at runtime. The spec documents
  an integer.
- Route parameters typed as `StellarAddress` are not validated by the server.
  An invalid address returns empty stats, not `400`.

### Residual risk

- SQLite `SUM` of 64-bit integers raises an overflow error above 2^63 − 1
  stroops (about 9.2 × 10^11 USDC in total). The endpoint then returns 500. That
  is far above realistic volume.
- The conformance test validates the JSON schema subset this spec uses (`type`,
  `required`, `enum`, `nullable`, `pattern`, `anyOf`, `items`,
  `additionalProperties`, `minimum`/`maximum`, `date-time`). It is not a full
  OpenAPI validator.

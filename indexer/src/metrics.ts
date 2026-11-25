import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

// Central registry for all metrics exported by the indexer.
export const registry = new Registry();

// Collect node/process default metrics with `iln_` prefix.
collectDefaultMetrics({ register: registry, prefix: 'iln_' });

export const dbQueryDuration = new Histogram({
  name: 'iln_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
  registers: [registry],
});

export const dbErrorsTotal = new Counter({
  name: 'iln_db_errors_total',
  help: 'Database errors',
  registers: [registry],
});

export const eventsProcessedTotal = new Counter({
  name: 'iln_events_processed_total',
  help: 'Number of contract events processed',
  registers: [registry],
});

export const duplicateEventsTotal = new Counter({
  name: 'iln_duplicate_events_total',
  help: 'Number of duplicate contract events detected and skipped',
  registers: [registry],
});

export const invoicesUpsertedTotal = new Counter({
  name: 'iln_invoices_upserted_total',
  help: 'Number of invoices upserted into the DB',
  registers: [registry],
});

export const lastProcessedLedger = new Gauge({
  name: 'iln_last_processed_ledger',
  help: 'Last processed ledger sequence number',
  registers: [registry],
});

export const reorgRollbacksTotal = new Counter({
  name: 'iln_reorg_rollbacks_total',
  help: 'Number of chain reorganisations detected and rolled back by the poller',
  registers: [registry],
});

export const reorgAbortionsTotal = new Counter({
  name: 'iln_reorg_abortions_total',
  help: 'Number of polling cycles aborted because the chain reorg did not stabilise',
  registers: [registry],
});

export const reorgRemovedEventsTotal = new Counter({
  name: 'iln_reorg_removed_events_total',
  help: 'Number of contract events rolled back and removed during chain re-orgs',
  registers: [registry],
});

export const reorgForkDecisionsTotal = new Counter({
  name: 'iln_reorg_fork_decisions_total',
  help: 'Total number of fork replacement decisions recorded for restart safety',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const reorgPendingDecisions = new Gauge({
  name: 'iln_reorg_pending_decisions',
  help: 'Number of in-progress fork replacement decisions currently pending completion',
  registers: [registry],
});

export const reorgQuarantinedTotal = new Counter({
  name: 'iln_reorg_quarantined_total',
  help: 'Total number of incomplete or corrupted reorg recoveries quarantined',
  registers: [registry],
});

export const reorgQuarantinedActive = new Gauge({
  name: 'iln_reorg_quarantined_active',
  help: 'Current number of active quarantined reorg recovery records',
  registers: [registry],
});

export const cursorMonotonicityViolationsTotal = new Counter({
  name: 'iln_cursor_monotonicity_violations_total',
  help: 'Total number of attempts to rewind the cursor outside of an authorized rollback',
  registers: [registry],
});

export const confirmationDepthGauge = new Gauge({
  name: 'iln_confirmation_depth',
  help: 'Configured canonical-ledger confirmation depth policy threshold',
  registers: [registry],
});

export const unconfirmedEventsSkippedTotal = new Counter({
  name: 'iln_unconfirmed_events_skipped_total',
  help: 'Total number of unconfirmed events deferred by confirmation depth policy',
  registers: [registry],
});

export const confirmedTipLedger = new Gauge({
  name: 'iln_confirmed_tip_ledger',
  help: 'Highest confirmed canonical ledger tip sequence number',
  registers: [registry],
});

export const cursorUpdatedAt = new Gauge({
  name: 'iln_cursor_updated_at',
  help: 'Timestamp (ms) when cursor was last updated',
  registers: [registry],
});

// ── Startup configuration control (docs/indexer/operations-checks.md) ──────

export const configInfo = new Gauge({
  name: 'iln_indexer_config_info',
  help: 'Always 1 once startup configuration validation passed; labels identify what this instance indexes',
  labelNames: ['network', 'contract_id'] as const,
  registers: [registry],
});

export const configWarnings = new Gauge({
  name: 'iln_indexer_config_warnings',
  help: 'Number of non-fatal configuration warnings reported at startup',
  registers: [registry],
});

// ── Analytics query isolation metrics ────────────────────────────────────────

export const analyticsQueryDuration = new Histogram({
  name: 'iln_analytics_query_duration_seconds',
  help: 'Analytics aggregation query duration in seconds (isolated from production path)',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const analyticsQueryExceededBudget = new Counter({
  name: 'iln_analytics_query_exceeded_budget_total',
  help: 'Count of analytics queries that exceeded the configured time budget',
  registers: [registry],
});

// ── SLO instrumentation (latency & availability) ───────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'iln_http_requests_total',
  help: 'Total HTTP requests by method, route, and status',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpErrorsTotal = new Counter({
  name: 'iln_http_errors_total',
  help: 'Total HTTP errors (status >= 500) by method and route',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'iln_http_request_duration_seconds',
  help: 'HTTP request latency in seconds by method and route',
  labelNames: ['method', 'route'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

// ── Cost attribution (per-service, per-operation) ──────────────────────────

export const costUsdTotal = new Counter({
  name: 'iln_cost_usd_total',
  help: 'Attributed cost in USD by service and operation',
  labelNames: ['service', 'operation'] as const,
  registers: [registry],
});

export function observeHttpRequest(
  method: string,
  route: string,
  status: number,
  durationSeconds: number
): void {
  try {
    httpRequestsTotal.inc({ method, route, status: String(status) });
    if (status >= 500) {
      httpErrorsTotal.inc({ method, route, status: String(status) });
    }
    httpRequestDuration.observe({ method, route }, durationSeconds);
    // Cost attribution: ~$0.00002 per read request (RPC + DB)
    costUsdTotal.inc({ service: 'indexer', operation: 'http_request' }, 0.00002);
  } catch {
    /* non-fatal */
  }
}

/** Cache invalidations that could not reach Redis; entries may be stale for up to the TTL (#1445). */
export const cacheInvalidationFailuresTotal = new Counter({
  name: 'iln_cache_invalidation_failures_total',
  help: 'Cache invalidations that failed; stale entries expire within the cache TTL',
  registers: [registry],
});

/** Cache writes skipped because an invalidation happened while the response was being built (#1445). */
export const cacheStaleWritesSkippedTotal = new Counter({
  name: 'iln_cache_stale_writes_skipped_total',
  help: 'Cache writes skipped because the cache generation changed during the request',
  registers: [registry],
});

/** Rate-limit store (Redis) failures; affected requests were allowed through (#1446). */
export const rateLimitStoreErrorsTotal = new Counter({
  name: 'iln_rate_limit_store_errors_total',
  help: 'Rate limit store failures; the affected requests were allowed (fail open)',
  registers: [registry],
});

// ── Indexer health & lag (#1453) ─────────────────────────────────────────────
//
// Conventions for the metrics below (see docs/indexer/observability-audit.md):
//  - Ages and timestamps are in *seconds* (Prometheus base unit). The older
//    `iln_cursor_updated_at` gauge is kept in milliseconds for compatibility.
//  - A value that is unknown (never synced, database unreadable, no RPC answer
//    yet) is *absent*, never 0, so `absent()` alerts fire instead of a 0 that
//    looks healthy.
//  - RPC endpoints are labelled by role (`primary`, `fallback_1`, …), never by
//    URL, because RPC URLs can carry API keys.

export const networkLatestLedger = new Gauge({
  name: 'iln_network_latest_ledger',
  help: 'Latest ledger sequence reported by the RPC node in the most recent successful getEvents call',
  registers: [registry],
});

export const ledgerLag = new Gauge({
  name: 'iln_ledger_lag',
  help: 'Ledgers between the RPC network tip and the persisted cursor (network tip - cursor), set after each successful poll',
  registers: [registry],
});

let cursorTimestampSource: (() => number | null) | null = null;

/**
 * Register where the cursor's last-write time (Unix ms) is read from at scrape
 * time. db.ts registers `getCursorUpdatedAt` so the age always reflects the
 * persisted cursor row (the source of truth), including after a restart.
 */
export function setCursorTimestampSource(source: (() => number | null) | null): void {
  cursorTimestampSource = source;
}

export const cursorAgeSeconds = new Gauge({
  name: 'iln_cursor_age_seconds',
  help: 'Seconds since the persisted cursor was last advanced; absent when never synced or the database is unreadable',
  // prom-client always emits an unlabelled gauge (as 0 after reset), which
  // would make "unknown" look "fresh". A label lets the series be absent.
  labelNames: ['source'] as const,
  registers: [registry],
  collect() {
    let updatedAtMs: number | null = null;
    try {
      updatedAtMs = cursorTimestampSource ? cursorTimestampSource() : null;
    } catch {
      updatedAtMs = null;
    }
    this.reset();
    if (updatedAtMs !== null && Number.isFinite(updatedAtMs)) {
      // A cursor written by a host with a skewed clock can be "in the future";
      // clamp to 0 rather than export a negative age.
      this.set({ source: 'cursor_table' }, Math.max(0, (Date.now() - updatedAtMs) / 1000));
    }
  },
});

export const pollCyclesTotal = new Counter({
  name: 'iln_poll_cycles_total',
  help: 'Completed polling cycles by outcome (success | failure)',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const lastSuccessfulPollTimestamp = new Gauge({
  name: 'iln_last_successful_poll_timestamp_seconds',
  help: 'Unix time (seconds) at which the last polling cycle completed without error',
  registers: [registry],
});

export const reorgRollbackDepth = new Histogram({
  name: 'iln_reorg_rollback_depth_ledgers',
  help: 'Ledgers rolled back per detected chain re-org (cursor - rollback target)',
  buckets: [1, 2, 5, 10, 25, 50, 100],
  registers: [registry],
});

// ── RPC transport (#1454) ────────────────────────────────────────────────────

export const rpcRequestsTotal = new Counter({
  name: 'iln_rpc_requests_total',
  help: 'RPC read attempts by endpoint role, operation and outcome (success | timeout | transport_error | rpc_error)',
  labelNames: ['endpoint', 'operation', 'outcome'] as const,
  registers: [registry],
});

export const rpcFailoversTotal = new Counter({
  name: 'iln_rpc_failovers_total',
  help: 'Times an RPC read moved to the next configured endpoint after a timeout or transport error',
  labelNames: ['operation', 'from'] as const,
  registers: [registry],
});

// ── Dead-letter queue (#1453) ────────────────────────────────────────────────

interface DeadLetterStatsSource {
  stats(): { pending: number; exhausted: number };
}

const deadLetterQueues = new Set<DeadLetterStatsSource>();

/** Report a dead-letter queue in `iln_dlq_entries`. Returns an unregister function. */
export function registerDeadLetterQueue(queue: DeadLetterStatsSource): () => void {
  deadLetterQueues.add(queue);
  return () => {
    deadLetterQueues.delete(queue);
  };
}

export const dlqEntries = new Gauge({
  name: 'iln_dlq_entries',
  help: 'Dead-letter entries by state (pending | exhausted) across registered queues; absent when no queue is registered',
  labelNames: ['state'] as const,
  registers: [registry],
  collect() {
    this.reset();
    if (deadLetterQueues.size === 0) return;
    let pending = 0;
    let exhausted = 0;
    for (const queue of deadLetterQueues) {
      try {
        const s = queue.stats();
        pending += s.pending;
        exhausted += s.exhausted;
      } catch {
        /* a failing queue must not break the scrape */
      }
    }
    this.set({ state: 'pending' }, pending);
    this.set({ state: 'exhausted' }, exhausted);
  },
});

export const dlqEnqueuedTotal = new Counter({
  name: 'iln_dlq_enqueued_total',
  help: 'Failed attempts recorded in dead-letter queues (first failures and repeated failures)',
  registers: [registry],
});

export const dlqExhaustedTotal = new Counter({
  name: 'iln_dlq_exhausted_total',
  help: 'Dead-letter entries that reached their attempt budget (or failed permanently) and stopped retrying',
  registers: [registry],
});

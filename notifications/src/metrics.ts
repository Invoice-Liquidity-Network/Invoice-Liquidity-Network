/**
 * Notification Service Metrics & Delivery Service Level Objectives (SLOs) (#1471).
 *
 * Provides Prometheus-compatible telemetry for notification lifecycle monitoring,
 * including delivery latency distributions, retry attempts and exhaustion, failure categorization,
 * dead-letter queue depth, and provider health status.
 *
 * Delivery SLO Metrics Audit (#1471):
 * ─────────────────────────────────────────────────────────────────────────────
 * • Source of Truth:
 *   - Prometheus `client.Registry` holding durable metrics collectors.
 *   - Point-in-time gauges tracking active retries, dead-letter depths, and provider health.
 *
 * • SLO Target Specifications:
 *   - Latency SLO: p95 delivery latency < 500ms, p99 < 2000ms. Measured via `deliveryLatencySlo`.
 *   - Retry SLO: Delivery completes in <= 3 attempts without retry exhaustion (< 1% exhausted).
 *   - Failures SLO: Failures classified by error type (timeout, 5xx, rate_limit, circuit_open).
 *   - Dead-Letter SLO: Dead-letter queue depth monitored with alert triggered if depth > threshold (10).
 *   - Provider Health SLO: Availability ratio tracking 1.0 (healthy), 0.5 (degraded), 0.0 (unhealthy).
 *
 * • Operational & Failure Modes:
 *   - Normal: In-SLO latency recorded; dispatches incremented; provider health remains at 1.0.
 *   - Failed: Categorized failures recorded; retries tracked by attempt count; retry exhaustion logged.
 *   - Repeated: Monotonic counters accumulate safely across replays; gauges maintain exact state.
 *   - Stale: In-memory counters reinitialized on node restart; durable trends scraped into Prometheus.
 *   - Interrupted: Clean error-handling and finally blocks ensure active retries do not leak.
 *
 * • Residual Risk & Maintainer Decisions:
 *   - In-memory aggregation: Scrape intervals (typically 15s) must be maintained to avoid data gaps.
 *   - Maintainer Decision: Default dead-letter alert threshold set to 10 entries.
 */

import client, { type Registry } from 'prom-client';

export interface NotificationsMetrics {
  registry: Registry;
  dispatchesTotal: client.Counter<string>;
  failuresTotal: client.Counter<string>;
  rateLimitHitsTotal: client.Counter<string>;
  deliveryDuration: client.Histogram<string>;
  activeSubscriptions: client.Gauge<string>;
  costUsdTotal: client.Counter<string>;
  fallbackDeliveriesTotal: client.Counter<string>;
  healthChecksTotal: client.Counter<string>;
  auditRecordsTotal: client.Counter<string>;
  dispatchAttemptsTotal: client.Counter<string>;
  dispatchTerminalTotal: client.Counter<string>;
  dispatchQueue: client.Gauge<string>;
  recipientRejectionsTotal: client.Counter<string>;
  eventIngestTotal: client.Counter<string>;
  eventInbox: client.Gauge<string>;

  // ── Delivery SLO Metrics (#1471) ──────────────────────────────────────────
  retryAttemptsTotal: client.Counter<string>;
  activeRetries: client.Gauge<string>;
  retryExhaustionTotal: client.Counter<string>;
  deliveryLatencySlo: client.Histogram<string>;
  sloBreachesTotal: client.Counter<string>;
  failuresByErrorTypeTotal: client.Counter<string>;
  deadLetterTotal: client.Counter<string>;
  deadLetterQueueDepth: client.Gauge<string>;
  deadLetterAlertThresholdExceeded: client.Counter<string>;
  providerHealthStatus: client.Gauge<string>;
  providerOutageDurationSeconds: client.Counter<string>;

  // Recorder methods
  recordEventIngest(result: 'processed' | 'retry' | 'dead_lettered' | 'duplicate', reason?: string): void;
  recordDispatchAttempt(channel: string, result: 'delivered' | 'retry' | 'terminal'): void;
  recordDispatchTerminal(channel: string, outcome: string): void;
  recordRecipientRejection(channel: string, stage: string, reason: string): void;
  recordDispatch(channel: string, trigger: string): void;
  recordFailure(channel: string, reason: string): void;
  recordRateLimitHit(channel: string): void;
  recordCost(channel: string, usd: number): void;
  recordFallback(primary: string, fallback: string, priority: string): void;
  recordRetry(channel: string, attempt: number, exhausted?: boolean): void;
  recordDeliveryLatencySlo(channel: string, durationSeconds: number): void;
  recordFailureByType(channel: string, errorType: string): void;
  recordDeadLetter(channel: string, reason: string, currentDepth?: number): void;
  recordProviderHealthStatus(channel: string, status: 'healthy' | 'degraded' | 'unhealthy'): void;
}

export function createNotificationsMetrics(): NotificationsMetrics {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: 'iln_notifications_' });

  const dispatchesTotal = new client.Counter({
    name: 'iln_notifications_dispatches_total',
    help: 'Total notification dispatches by channel and trigger',
    labelNames: ['channel', 'trigger'] as const,
    registers: [registry],
  });

  const failuresTotal = new client.Counter({
    name: 'iln_notifications_failures_total',
    help: 'Total notification delivery failures by channel and reason',
    labelNames: ['channel', 'reason'] as const,
    registers: [registry],
  });

  const rateLimitHitsTotal = new client.Counter({
    name: 'iln_notifications_rate_limit_hits_total',
    help: 'Total rate-limit rejections (429) by channel',
    labelNames: ['channel'] as const,
    registers: [registry],
  });

  const deliveryDuration = new client.Histogram({
    name: 'iln_notifications_delivery_duration_seconds',
    help: 'Notification delivery latency in seconds',
    labelNames: ['channel'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const activeSubscriptions = new client.Gauge({
    name: 'iln_notifications_active_subscriptions',
    help: 'Current active subscriptions by channel',
    labelNames: ['channel'] as const,
    registers: [registry],
  });

  const costUsdTotal = new client.Counter({
    name: 'iln_notifications_cost_usd_total',
    help: 'Attributed cost in USD by channel and operation',
    labelNames: ['channel', 'operation'] as const,
    registers: [registry],
  });

  const fallbackDeliveriesTotal = new client.Counter({
    name: 'iln_notifications_fallback_deliveries_total',
    help: 'Fallback channel deliveries by primary, fallback, and priority',
    labelNames: ['primary', 'fallback', 'priority'] as const,
    registers: [registry],
  });

  const healthChecksTotal = new client.Counter({
    name: 'iln_notifications_health_checks_total',
    help: 'Provider health checks by channel and result',
    labelNames: ['channel', 'result'] as const,
    registers: [registry],
  });

  const auditRecordsTotal = new client.Counter({
    name: 'iln_notifications_audit_records_total',
    help: 'Delivery audit records created by status and channel',
    labelNames: ['status', 'channel'] as const,
    registers: [registry],
  });

  // Issue #1277: every provider attempt against the durable journal, and the
  // terminal outcome each row ends in.
  const dispatchAttemptsTotal = new client.Counter({
    name: 'iln_notifications_dispatch_attempts_total',
    help: 'Journal dispatch attempts by channel and result (delivered, retry, terminal)',
    labelNames: ['channel', 'result'] as const,
    registers: [registry],
  });

  const dispatchTerminalTotal = new client.Counter({
    name: 'iln_notifications_dispatch_terminal_total',
    help: 'Journal rows reaching a terminal state by channel and outcome reason',
    labelNames: ['channel', 'outcome'] as const,
    registers: [registry],
  });

  const dispatchQueue = new client.Gauge({
    name: 'iln_notifications_dispatch_queue',
    help: 'Journal rows by status, plus oldest_pending_age_seconds and max_pending_attempts',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  // Issues #1278/#1279: recipients refused before enqueue.
  const recipientRejectionsTotal = new client.Counter({
    name: 'iln_notifications_recipient_rejections_total',
    help: 'Notification recipients rejected before enqueue by channel, stage and reason',
    labelNames: ['channel', 'stage', 'reason'] as const,
    registers: [registry],
  });

  // Issues #1273-#1276: chain-event ingestion outcomes and inbox depth.
  const eventIngestTotal = new client.Counter({
    name: 'iln_notifications_event_ingest_total',
    help: 'Chain events by ingestion result (processed, retry, dead_lettered, duplicate) and reason',
    labelNames: ['result', 'reason'] as const,
    registers: [registry],
  });

  const eventInbox = new client.Gauge({
    name: 'iln_notifications_event_inbox',
    help: 'Event inbox rows by status, plus oldest_pending_age_seconds and max_pending_attempts',
    labelNames: ['status'] as const,
    registers: [registry],
  });

  // ── Delivery SLO Metrics (#1471) ──────────────────────────────────────────

  const retryAttemptsTotal = new client.Counter({
    name: 'iln_notifications_retry_attempts_total',
    help: 'Total delivery retry attempts by channel and attempt number',
    labelNames: ['channel', 'attempt'] as const,
    registers: [registry],
  });

  const activeRetries = new client.Gauge({
    name: 'iln_notifications_active_retries',
    help: 'Currently active in-flight retries by channel',
    labelNames: ['channel'] as const,
    registers: [registry],
  });

  const retryExhaustionTotal = new client.Counter({
    name: 'iln_notifications_retry_exhaustion_total',
    help: 'Notification deliveries that exhausted all retries (SLO breach) by channel',
    labelNames: ['channel'] as const,
    registers: [registry],
  });

  const deliveryLatencySlo = new client.Histogram({
    name: 'iln_notifications_delivery_latency_slo_seconds',
    help: 'Delivery latency distribution against SLO targets (p95 < 500ms, p99 < 2000ms)',
    labelNames: ['channel'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  });

  const sloBreachesTotal = new client.Counter({
    name: 'iln_notifications_slo_breaches_total',
    help: 'Total delivery SLO breaches by channel and SLO type (latency, retry_exhaustion)',
    labelNames: ['channel', 'slo_type'] as const,
    registers: [registry],
  });

  const failuresByErrorTypeTotal = new client.Counter({
    name: 'iln_notifications_failures_by_error_type_total',
    help: 'Delivery failures categorized by error classification and channel',
    labelNames: ['channel', 'error_type'] as const,
    registers: [registry],
  });

  const deadLetterTotal = new client.Counter({
    name: 'iln_notifications_dead_letter_total',
    help: 'Total dead-letter queue additions by channel and failure reason',
    labelNames: ['channel', 'reason'] as const,
    registers: [registry],
  });

  const deadLetterQueueDepth = new client.Gauge({
    name: 'iln_notifications_dead_letter_queue_depth',
    help: 'Current depth of dead-letter queue by channel',
    labelNames: ['channel'] as const,
    registers: [registry],
  });

  const deadLetterAlertThresholdExceeded = new client.Counter({
    name: 'iln_notifications_dead_letter_alert_threshold_exceeded_total',
    help: 'Alert triggers when dead-letter queue depth exceeds configured threshold (10)',
    labelNames: ['channel'] as const,
    registers: [registry],
  });

  const providerHealthStatus = new client.Gauge({
    name: 'iln_notifications_provider_health_status',
    help: 'Provider health status indicator by channel (1 = healthy, 0.5 = degraded, 0 = unhealthy)',
    labelNames: ['channel'] as const,
    registers: [registry],
  });

  const providerOutageDurationSeconds = new client.Counter({
    name: 'iln_notifications_provider_outage_duration_seconds_total',
    help: 'Cumulative provider outage duration in seconds by channel',
    labelNames: ['channel'] as const,
    registers: [registry],
  });

  function recordEventIngest(
    result: 'processed' | 'retry' | 'dead_lettered' | 'duplicate',
    reason = 'none'
  ): void {
    eventIngestTotal.inc({ result, reason });
  }

  function recordDispatchAttempt(channel: string, result: 'delivered' | 'retry' | 'terminal'): void {
    dispatchAttemptsTotal.inc({ channel, result });
  }

  function recordDispatchTerminal(channel: string, outcome: string): void {
    dispatchTerminalTotal.inc({ channel, outcome });
  }

  function recordRecipientRejection(channel: string, stage: string, reason: string): void {
    recipientRejectionsTotal.inc({ channel, stage, reason });
  }

  function recordDispatch(channel: string, trigger: string): void {
    dispatchesTotal.inc({ channel, trigger });
  }

  function recordFailure(channel: string, reason: string): void {
    failuresTotal.inc({ channel, reason });
  }

  function recordRateLimitHit(channel: string): void {
    rateLimitHitsTotal.inc({ channel });
  }

  function recordCost(channel: string, usd: number): void {
    costUsdTotal.inc({ channel, operation: 'dispatch' }, usd);
  }

  function recordFallback(primary: string, fallback: string, priority: string): void {
    fallbackDeliveriesTotal.inc({ primary, fallback, priority });
  }

  function recordRetry(channel: string, attempt: number, exhausted = false): void {
    retryAttemptsTotal.inc({ channel, attempt: String(attempt) });
    if (exhausted) {
      retryExhaustionTotal.inc({ channel });
      sloBreachesTotal.inc({ channel, slo_type: 'retry_exhaustion' });
    }
  }

  function recordDeliveryLatencySlo(channel: string, durationSeconds: number): void {
    deliveryLatencySlo.observe({ channel }, durationSeconds);
    if (durationSeconds > 0.5) {
      sloBreachesTotal.inc({ channel, slo_type: 'latency_p95' });
    }
  }

  function recordFailureByType(channel: string, errorType: string): void {
    failuresByErrorTypeTotal.inc({ channel, error_type: errorType });
  }

  const DLQ_ALERT_DEPTH = 10;
  function recordDeadLetter(channel: string, reason: string, currentDepth?: number): void {
    deadLetterTotal.inc({ channel, reason });
    if (typeof currentDepth === 'number') {
      deadLetterQueueDepth.set({ channel }, currentDepth);
      if (currentDepth >= DLQ_ALERT_DEPTH) {
        deadLetterAlertThresholdExceeded.inc({ channel });
      }
    }
  }

  function recordProviderHealthStatus(
    channel: string,
    status: 'healthy' | 'degraded' | 'unhealthy'
  ): void {
    const value = status === 'healthy' ? 1 : status === 'degraded' ? 0.5 : 0;
    providerHealthStatus.set({ channel }, value);
  }

  return {
    registry,
    dispatchesTotal,
    failuresTotal,
    rateLimitHitsTotal,
    deliveryDuration,
    activeSubscriptions,
    costUsdTotal,
    fallbackDeliveriesTotal,
    healthChecksTotal,
    auditRecordsTotal,
    dispatchAttemptsTotal,
    dispatchTerminalTotal,
    dispatchQueue,
    recipientRejectionsTotal,
    eventIngestTotal,
    eventInbox,
    retryAttemptsTotal,
    activeRetries,
    retryExhaustionTotal,
    deliveryLatencySlo,
    sloBreachesTotal,
    failuresByErrorTypeTotal,
    deadLetterTotal,
    deadLetterQueueDepth,
    deadLetterAlertThresholdExceeded,
    providerHealthStatus,
    providerOutageDurationSeconds,
    recordEventIngest,
    recordDispatchAttempt,
    recordDispatchTerminal,
    recordRecipientRejection,
    recordDispatch,
    recordFailure,
    recordRateLimitHit,
    recordCost,
    recordFallback,
    recordRetry,
    recordDeliveryLatencySlo,
    recordFailureByType,
    recordDeadLetter,
    recordProviderHealthStatus,
  };
}

// Singleton for runtime
export const notificationsMetrics = createNotificationsMetrics();

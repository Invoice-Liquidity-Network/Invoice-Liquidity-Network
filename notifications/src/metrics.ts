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
  duplicatesSkippedTotal: client.Counter<string>;
  recordDuplicateSkipped(channel: string, trigger: string): void;
  recordDispatchAttempt(channel: string, result: 'delivered' | 'retry' | 'terminal'): void;
  recordDispatchTerminal(channel: string, outcome: string): void;
  recordRecipientRejection(channel: string, stage: string, reason: string): void;
  recordDispatch(channel: string, trigger: string): void;
  recordFailure(channel: string, reason: string): void;
  recordRateLimitHit(channel: string): void;
  recordCost(channel: string, usd: number): void;
  recordFallback(primary: string, fallback: string, priority: string): void;
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

  // Issue #1276: count duplicate notifications skipped to prove idempotency controls are active.
  const duplicatesSkippedTotal = new client.Counter({
    name: 'iln_notifications_duplicates_skipped_total',
    help: 'Total duplicate notifications skipped by channel and trigger',
    labelNames: ['channel', 'trigger'] as const,
    registers: [registry],
  });

  function recordDuplicateSkipped(channel: string, trigger: string): void {
    duplicatesSkippedTotal.inc({ channel, trigger });
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
    duplicatesSkippedTotal,
    recordDuplicateSkipped,
    recordDispatchAttempt,
    recordDispatchTerminal,
    recordRecipientRejection,
    recordDispatch,
    recordFailure,
    recordRateLimitHit,
    recordCost,
    recordFallback,
  };
}

// Singleton for runtime
export const notificationsMetrics = createNotificationsMetrics();

/**
 * Issues #1273-#1276 — durable, bounded, idempotent chain-event ingestion.
 *
 * Before this control `processEvent` wrote the `events` row *before* fetching
 * the invoice. A failed `get_invoice` left the event "seen" while the poller's
 * cursor moved past it: the notification was lost and could never be replayed.
 * The cases below drive the real processor + SQLite (only the RPC and provider
 * boundaries are stubbed) and fail if that ordering, the retry bound, the
 * dead-letter state or the replay idempotence regress.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { nativeToScVal } from '@stellar/stellar-sdk';

const { fetchInvoice, deliverNotification } = vi.hoisted(() => ({
  fetchInvoice: vi.fn(),
  deliverNotification: vi.fn(),
}));

vi.mock('../src/rpc', () => ({ fetchInvoice, server: {} }));
vi.mock('../src/delivery', () => ({
  deliverNotification,
  getCircuitBreakerState: () => 'closed',
}));
vi.mock('../src/fallback', () => ({ deliverWithFallback: vi.fn() }));
vi.mock('../src/provider-health', () => ({ getProviderHealth: () => 'healthy' }));

import { CONFIG } from '../src/config';
import {
  completeInboundEvent,
  createDb,
  createSubscription,
  eventRetryDelayMs,
  getInboundEvent,
  getInboundEventSummary,
  hasEvent,
  listInboundEvents,
  recordInboundEventFailure,
  requeueDeadInboundEvent,
  setDb,
  verifyComplianceAuditChain,
} from '../src/db';
import { flushPendingEvents, processEvent } from '../src/processor';
import { notificationsMetrics } from '../src/metrics';

const NOW = 1_800_000_000_000;
const FREELANCER = 'GAFREELANCER';

const invoice = {
  id: 7,
  freelancer: FREELANCER,
  payer: 'GAPAYER',
  amount: '10000000',
  due_date: Math.floor(NOW / 1000) + 86_400,
  discount_rate: 300,
  status: 'Funded' as const,
  funder: 'GLP',
  funded_at: Math.floor(NOW / 1000),
};

function makeEvent(id: string, value: unknown = BigInt(invoice.id), type = 'funded') {
  return {
    id,
    topic: [nativeToScVal(type)],
    value: nativeToScVal(value as never),
    ledger: 10,
    ledgerClosedAt: new Date(NOW).toISOString(),
  } as never;
}

function ingestCount(result: string, reason = 'none'): number {
  const metric = notificationsMetrics.eventIngestTotal as unknown as {
    hashMap: Record<string, { value: number; labels: Record<string, string> }>;
  };
  return Object.values(metric.hashMap)
    .filter((m) => m.labels.result === result && m.labels.reason === reason)
    .reduce((sum, m) => sum + m.value, 0);
}

let db: InstanceType<typeof Database>;

function subscribe(): void {
  createSubscription({
    stellar_address: FREELANCER,
    channel: 'email',
    destination: 'freelancer@example.com',
    triggers: ['invoice_funded'],
    ownership_verified_at: NOW,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchInvoice.mockReset();
  deliverNotification.mockReset().mockResolvedValue(undefined);
  db = createDb(':memory:');
  setDb(db);
  subscribe();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('event ingestion: success', () => {
  it('records the event only after the invoice was retrieved and notified', async () => {
    fetchInvoice.mockResolvedValue(invoice);
    await processEvent(makeEvent('evt-ok'));

    expect(hasEvent('evt-ok')).toBe(true);
    expect(getInboundEvent('evt-ok')?.status).toBe('processed');
    expect(deliverNotification).toHaveBeenCalledTimes(1);
  });
});

describe('#1274 recorded-before-retrieved event loss', () => {
  it('does not record the event when the invoice cannot be retrieved', async () => {
    fetchInvoice.mockResolvedValue(null);
    await processEvent(makeEvent('evt-lost'));

    expect(hasEvent('evt-lost')).toBe(false);
    const row = getInboundEvent('evt-lost');
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(deliverNotification).not.toHaveBeenCalled();
  });

  it('treats a throwing fetch like a failed fetch instead of stalling the poller', async () => {
    fetchInvoice.mockRejectedValue(new Error('rpc down'));
    await expect(processEvent(makeEvent('evt-throw'))).resolves.toBeUndefined();

    expect(hasEvent('evt-throw')).toBe(false);
    expect(getInboundEvent('evt-throw')?.last_error).toContain('rpc down');
  });

  it('delivers the notification once the dependency recovers', async () => {
    fetchInvoice.mockResolvedValueOnce(null).mockResolvedValue(invoice);
    await processEvent(makeEvent('evt-recover'));
    expect(deliverNotification).not.toHaveBeenCalled();

    vi.setSystemTime(NOW + eventRetryDelayMs(1));
    await flushPendingEvents();

    expect(hasEvent('evt-recover')).toBe(true);
    expect(getInboundEvent('evt-recover')?.status).toBe('processed');
    expect(deliverNotification).toHaveBeenCalledTimes(1);
  });

  it('keeps the event retryable across a process restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iln-event-inbox-'));
    const file = join(dir, 'notifications.sqlite');
    try {
      const first = createDb(file);
      setDb(first);
      subscribe();
      fetchInvoice.mockResolvedValue(null);
      await processEvent(makeEvent('evt-restart'));
      first.close();

      // New process: only the file survives.
      const second = createDb(file);
      setDb(second);
      expect(hasEvent('evt-restart')).toBe(false);
      expect(getInboundEvent('evt-restart')?.status).toBe('pending');

      fetchInvoice.mockResolvedValue(invoice);
      vi.setSystemTime(NOW + eventRetryDelayMs(1));
      await flushPendingEvents();

      expect(hasEvent('evt-restart')).toBe(true);
      expect(deliverNotification).toHaveBeenCalledTimes(1);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#1275 bounded retry and backoff', () => {
  it('backs off exponentially up to the configured cap', () => {
    const base = CONFIG.eventRetryBaseMs;
    expect(eventRetryDelayMs(1)).toBe(base);
    expect(eventRetryDelayMs(2)).toBe(base * 2);
    expect(eventRetryDelayMs(3)).toBe(base * 4);
    expect(eventRetryDelayMs(50)).toBe(CONFIG.eventRetryMaxMs);
  });

  it('does not retry before the backoff elapses, and retries exactly at it', async () => {
    fetchInvoice.mockResolvedValue(null);
    await processEvent(makeEvent('evt-backoff'));
    expect(fetchInvoice).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + eventRetryDelayMs(1) - 1);
    await flushPendingEvents();
    expect(fetchInvoice).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + eventRetryDelayMs(1));
    await flushPendingEvents();
    expect(fetchInvoice).toHaveBeenCalledTimes(2);
  });

  it('stays pending one attempt short of the budget and stops at the budget', async () => {
    fetchInvoice.mockResolvedValue(null);
    await processEvent(makeEvent('evt-bound'));

    let clock = NOW;
    for (let attempt = 2; attempt < CONFIG.eventMaxAttempts; attempt++) {
      clock += CONFIG.eventRetryMaxMs;
      vi.setSystemTime(clock);
      await flushPendingEvents();
    }
    expect(getInboundEvent('evt-bound')).toMatchObject({
      status: 'pending',
      attempts: CONFIG.eventMaxAttempts - 1,
    });

    clock += CONFIG.eventRetryMaxMs;
    vi.setSystemTime(clock);
    await flushPendingEvents();
    expect(getInboundEvent('evt-bound')).toMatchObject({
      status: 'dead',
      attempts: CONFIG.eventMaxAttempts,
      outcome_reason: 'max_attempts_exhausted',
    });

    // A dead event is never picked up again, however long we wait.
    const calls = fetchInvoice.mock.calls.length;
    vi.setSystemTime(clock + 10 * CONFIG.eventRetryMaxMs);
    await flushPendingEvents();
    expect(fetchInvoice.mock.calls.length).toBe(calls);
  });
});

describe('#1273 dead-letter handling', () => {
  it('dead-letters an undecodable event without throwing or recording it', async () => {
    const before = ingestCount('dead_lettered', 'malformed_event');
    await expect(processEvent(makeEvent('evt-bad', 'not-a-number'))).resolves.toBeUndefined();

    expect(hasEvent('evt-bad')).toBe(false);
    expect(getInboundEvent('evt-bad')).toMatchObject({
      status: 'dead',
      outcome_reason: 'malformed_event',
    });
    expect(fetchInvoice).not.toHaveBeenCalled();
    expect(ingestCount('dead_lettered', 'malformed_event')).toBe(before + 1);
  });

  it('exposes dead letters in the summary and gauge', async () => {
    fetchInvoice.mockResolvedValue(null);
    await processEvent(makeEvent('evt-a'));
    await processEvent(makeEvent('evt-b', 'garbage'));

    expect(getInboundEventSummary()).toMatchObject({
      pending: 1,
      dead: 1,
      deadByReason: { malformed_event: 1 },
    });
    expect(listInboundEvents({ status: 'dead' }).map((e) => e.event_id)).toEqual(['evt-b']);
    const gauge = await notificationsMetrics.registry.getSingleMetricAsString(
      'iln_notifications_event_inbox'
    );
    expect(gauge).toContain('iln_notifications_event_inbox{status="dead"} 1');
  });

  it('lets an operator re-queue an exhausted event, with an audit entry', async () => {
    fetchInvoice.mockResolvedValue(null);
    await processEvent(makeEvent('evt-requeue'));
    recordInboundEventFailure('evt-requeue', 'forced', { maxAttempts: 1 });
    expect(getInboundEvent('evt-requeue')?.status).toBe('dead');

    expect(requeueDeadInboundEvent('evt-requeue', 'op-1')).toBe(true);
    expect(getInboundEvent('evt-requeue')).toMatchObject({ status: 'pending', attempts: 0 });

    fetchInvoice.mockResolvedValue(invoice);
    await flushPendingEvents();
    expect(hasEvent('evt-requeue')).toBe(true);
    expect(verifyComplianceAuditChain().valid).toBe(true);
  });

  it('refuses to re-queue malformed, unknown, pending or processed events', async () => {
    await processEvent(makeEvent('evt-malformed', 'garbage'));
    fetchInvoice.mockResolvedValue(invoice);
    await processEvent(makeEvent('evt-done'));
    fetchInvoice.mockResolvedValue(null);
    await processEvent(makeEvent('evt-pending'));

    for (const id of ['evt-malformed', 'evt-done', 'evt-pending', 'evt-missing']) {
      expect(requeueDeadInboundEvent(id, 'op-1')).toBe(false);
    }
  });

  it('ignores unrelated event types without journaling them', async () => {
    await processEvent(makeEvent('evt-other', BigInt(1), 'something_else'));
    expect(getInboundEvent('evt-other')).toBeUndefined();
    expect(fetchInvoice).not.toHaveBeenCalled();
  });
});

describe('#1276 idempotent duplicate delivery', () => {
  it('delivers once when the same event is polled repeatedly', async () => {
    fetchInvoice.mockResolvedValue(invoice);
    const event = makeEvent('evt-dup');
    await processEvent(event);
    await processEvent(event);
    await processEvent(event);

    expect(deliverNotification).toHaveBeenCalledTimes(1);
    expect(fetchInvoice).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch or re-send a pending event when it is replayed by the poller', async () => {
    fetchInvoice.mockResolvedValue(null);
    const event = makeEvent('evt-replay-pending');
    await processEvent(event);
    await processEvent(event);

    expect(fetchInvoice).toHaveBeenCalledTimes(1);
    expect(getInboundEvent('evt-replay-pending')?.attempts).toBe(1);
  });

  it('does not re-send when a crash left a delivered event un-completed', async () => {
    fetchInvoice.mockResolvedValue(invoice);
    await processEvent(makeEvent('evt-crash'));
    expect(deliverNotification).toHaveBeenCalledTimes(1);

    // Simulate dying after the provider call but before the event was closed.
    db.prepare("DELETE FROM events WHERE event_id = 'evt-crash'").run();
    db.prepare(
      "UPDATE event_inbox SET status = 'pending', next_attempt_at = 0 WHERE event_id = 'evt-crash'"
    ).run();

    await flushPendingEvents();

    expect(deliverNotification).toHaveBeenCalledTimes(1);
    expect(getInboundEvent('evt-crash')?.status).toBe('processed');
    expect(hasEvent('evt-crash')).toBe(true);
  });

  it('completes an event at most once', () => {
    db.prepare(
      `INSERT INTO event_inbox
         (event_id, event_type, invoice_id, ledger, ledger_closed_at, status,
          attempts, next_attempt_at, created_at, updated_at)
       VALUES ('evt-once', 'funded', 7, 10, 'x', 'pending', 0, 0, 0, 0)`
    ).run();
    expect(completeInboundEvent('evt-once')).toBe(true);
    expect(completeInboundEvent('evt-once')).toBe(false);
  });
});

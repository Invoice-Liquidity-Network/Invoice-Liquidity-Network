process.env.NOTIFICATIONS_RPC_URL = 'http://localhost:8000';
process.env.NOTIFICATIONS_CONTRACT_ID = 'GTESTCONTRACT';
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.RESEND_API_KEY = 'test-api-key';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { nativeToScVal } from '@stellar/stellar-sdk';
import {
  createDb,
  setDb,
  createSubscription,
  upsertInvoice,
  enqueueDispatchAttempt,
  getPendingDispatchAttempts,
  markDispatchAttemptDelivered,
  dispatchDestinationOf,
} from '../db';
import * as rpc from '../rpc';
import * as delivery from '../delivery';
import * as fallback from '../fallback';
import {
  processEvent,
  processScheduledNotifications,
  flushPendingNotifications,
} from '../processor';
import type { Invoice, NotificationPayload } from '../types';

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = createDb(':memory:');
  setDb(db);
  vi.restoreAllMocks();
});

describe('Notification processor', () => {
  it('sends invoice funded notifications for freelancer and payer', async () => {
    const invoice = {
      id: 1,
      freelancer: 'GAFREELANCER',
      payer: 'GAPAYER',
      amount: '10000000',
      due_date: Math.floor(Date.now() / 1000) + 86400,
      discount_rate: 300,
      status: 'Funded' as const,
      funder: 'GLP',
      funded_at: Math.floor(Date.now() / 1000),
    };

    vi.spyOn(rpc, 'fetchInvoice').mockResolvedValue(invoice as any);
    const deliverySpy = vi.spyOn(delivery, 'deliverNotification').mockResolvedValue();

    createSubscription({
      stellar_address: invoice.freelancer,
      channel: 'email',
      destination: 'freelancer@example.com',
      triggers: ['invoice_funded'],
    });
    createSubscription({
      stellar_address: invoice.payer,
      channel: 'webhook',
      destination: 'https://example.com/payer',
      triggers: ['invoice_funded'],
    });

    const event = {
      id: 'evt-1',
      topic: [nativeToScVal('funded')],
      value: nativeToScVal(BigInt(invoice.id)),
      ledger: 1,
      ledgerClosedAt: new Date().toISOString(),
    } as any;

    await processEvent(event);

    expect(deliverySpy).toHaveBeenCalledTimes(2);
    expect(deliverySpy.mock.calls[0][0].destination).toBe('freelancer@example.com');
    expect(deliverySpy.mock.calls[1][0].destination).toBe('https://example.com/payer');
  });

  it('sends due soon warning to the LP once', async () => {
    const now = Math.floor(Date.now() / 1000);
    upsertInvoice({
      id: 2,
      freelancer: 'GAFREELANCER',
      payer: 'GAPAYER',
      amount: '5000000',
      due_date: now + 47 * 3600,
      discount_rate: 200,
      status: 'Funded',
      funder: 'GLP',
      funded_at: now - 3600,
    });

    createSubscription({
      stellar_address: 'GLP',
      channel: 'webhook',
      destination: 'https://example.com/lp',
      triggers: ['invoice_due_soon'],
    });

    const deliverySpy = vi.spyOn(delivery, 'deliverNotification').mockResolvedValue();

    await processScheduledNotifications();
    await processScheduledNotifications();

    expect(deliverySpy).toHaveBeenCalledTimes(1);
  });

  it('sends overdue warning to the payer once', async () => {
    const now = Math.floor(Date.now() / 1000);
    upsertInvoice({
      id: 3,
      freelancer: 'GAFREELANCER',
      payer: 'GAPAYER',
      amount: '5000000',
      due_date: now - 3600,
      discount_rate: 200,
      status: 'Funded',
      funder: 'GLP',
      funded_at: now - 86400,
    });

    createSubscription({
      stellar_address: 'GAPAYER',
      channel: 'email',
      destination: 'payer@example.com',
      triggers: ['invoice_overdue'],
    });

    const deliverySpy = vi.spyOn(delivery, 'deliverNotification').mockResolvedValue();

    await processScheduledNotifications();
    await processScheduledNotifications();

    expect(deliverySpy).toHaveBeenCalledTimes(1);
  });

  it('writes the dispatch attempt durably before the provider is contacted', async () => {
    const invoice = sampleInvoice(4);

    vi.spyOn(rpc, 'fetchInvoice').mockResolvedValue(invoice as any);
    const deliverySpy = vi.spyOn(delivery, 'deliverNotification').mockResolvedValue();

    createSubscription({
      stellar_address: invoice.freelancer,
      channel: 'email',
      destination: 'funded@example.com',
      triggers: ['invoice_funded'],
    });

    await processEvent(fundedEvent('evt-persisted', invoice.id));

    // The journal — not the spy — proves the intent was written first and only
    // closed out once the provider confirmed the send.
    expect(getPendingDispatchAttempts()).toHaveLength(0);
    expect(dispatchAttemptRows(db)).toHaveLength(1);
    expect(dispatchAttemptRows(db)[0]).toMatchObject({
      status: 'delivered',
      attempts: 1,
      invoice_id: invoice.id,
      trigger: 'invoice_funded',
      recipient_address: invoice.freelancer,
      channel: 'email',
      destination: 'funded@example.com',
      event_id: 'evt-persisted',
    });
    expect(dispatchAttemptRows(db)[0].delivered_at).not.toBeNull();
    expect(deliverySpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * Issue #1059 — at-least-once delivery and dedup, queue semantics.
 *
 * `src/db` is never mocked here: the guarantee lives in the database, and an
 * empty-array stub of the queue would make every assertion below pass while the
 * feature did not exist. What a single process can show is that a failure leaves
 * durable pending work which a later flush picks up exactly once. The literal
 * "process killed mid-dispatch, brand-new process resumes" proof lives in
 * `tests/crash-recovery.test.ts`, which SIGKILLs a real child process and then
 * starts a second one against the same SQLite file.
 */
describe('dispatch attempt queue', () => {
  it('leaves a failed dispatch pending with the reason, and the flush retries it once', async () => {
    const invoice = sampleInvoice(42);
    vi.spyOn(rpc, 'fetchInvoice').mockResolvedValue(invoice as any);

    const delivered: string[] = [];
    const deliverySpy = vi
      .spyOn(delivery, 'deliverNotification')
      .mockImplementation(async (subscription) => {
        delivered.push(dispatchDestinationOf(subscription));
        throw new Error('provider connection reset');
      });

    // The in-process fallback chain would retry before the queue ever saw the
    // failure; stub it as "nothing to fall back to" so the row is left pending.
    vi.spyOn(fallback, 'deliverWithFallback').mockResolvedValue({
      attempted: false,
      success: false,
      priority: 'high',
      capacityAllowed: true,
      error: 'no fallback subscription',
    } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    createSubscription({
      stellar_address: invoice.freelancer,
      channel: 'email',
      destination: 'retry@example.com',
      triggers: ['invoice_funded'],
    });

    await processEvent(fundedEvent('evt-failed', invoice.id));

    expect(delivered).toEqual(['retry@example.com']);
    const rows = dispatchAttemptRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).toContain('provider connection reset');
    expect(countRows(db, 'sent_notifications')).toBe(0);

    const pending = getPendingDispatchAttempts();
    expect(pending).toHaveLength(1);
    // The queue hands the flush real types, not raw TEXT columns.
    expect(pending[0].payload.invoice.id).toBe(invoice.id);
    expect(pending[0].payload.trigger).toBe('invoice_funded');
    expect(pending[0].subscription.channel).toBe('email');

    // Provider recovered.
    deliverySpy.mockImplementation(async (subscription) => {
      delivered.push(dispatchDestinationOf(subscription));
    });

    await flushPendingNotifications();

    expect(delivered).toEqual(['retry@example.com', 'retry@example.com']);
    const afterFlush = dispatchAttemptRows(db);
    expect(afterFlush).toHaveLength(1);
    expect(afterFlush[0].status).toBe('delivered');
    expect(afterFlush[0].delivered_at).not.toBeNull();
    expect(afterFlush[0].attempts).toBe(2); // one failed send, one successful
    expect(afterFlush[0].last_error).toBeNull();
    expect(countRows(db, 'sent_notifications')).toBe(1);

    // Further polls find nothing pending and send nothing again.
    await flushPendingNotifications();
    await flushPendingNotifications();
    expect(delivered).toHaveLength(2);
    expect(getPendingDispatchAttempts()).toHaveLength(0);
    expect(countRows(db, 'dispatch_attempts')).toBe(1);
    expect(countRows(db, 'sent_notifications')).toBe(1);

    // Re-enqueueing the delivered notification is a no-op, not a second send.
    const replayed = enqueueDispatchAttempt(
      subscriptionRow(invoice.freelancer),
      samplePayload(invoice, 'evt-failed')
    );
    expect(replayed.deduplicated).toBe(true);
    expect(replayed.alreadyDelivered).toBe(true);
    expect(replayed.id).toBe(afterFlush[0].id);
    await flushPendingNotifications();
    expect(delivered).toHaveLength(2);
  });

  it('dedups on notification identity, not on the row id', () => {
    const invoice = sampleInvoice(43);
    const subscription = createSubscription({
      stellar_address: invoice.freelancer,
      channel: 'email',
      destination: 'dedup@example.com',
      triggers: ['invoice_funded'],
    });

    const first = enqueueDispatchAttempt(subscription, samplePayload(invoice));
    const second = enqueueDispatchAttempt(subscription, samplePayload(invoice));

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.id).toBe(first.id);
    expect(countRows(db, 'dispatch_attempts')).toBe(1);

    // A different event id is a different notification (and a different send).
    expect(enqueueDispatchAttempt(subscription, samplePayload(invoice, 'evt-other'))).toMatchObject(
      { deduplicated: false }
    );
    expect(countRows(db, 'dispatch_attempts')).toBe(2);

    // A different channel/destination for the same invoice and trigger too.
    const otherDestination = createSubscription({
      stellar_address: invoice.freelancer,
      channel: 'webhook',
      destination: 'https://example.com/hook',
      triggers: ['invoice_funded'],
    });
    expect(enqueueDispatchAttempt(otherDestination, samplePayload(invoice))).toMatchObject({
      deduplicated: false,
    });
    expect(countRows(db, 'dispatch_attempts')).toBe(3);

    // Marking delivered closes the row out instead of deleting the history, and
    // a second marker (a racing flush) loses.
    expect(markDispatchAttemptDelivered(first.id)).toBe(true);
    expect(markDispatchAttemptDelivered(first.id)).toBe(false);
    expect(getPendingDispatchAttempts().map((attempt) => attempt.id)).not.toContain(first.id);
    expect(countRows(db, 'dispatch_attempts')).toBe(3);
  });

  it('keeps failed rows pending and does not let one failure abort the flush', async () => {
    const invoiceA = sampleInvoice(44);
    const invoiceB = sampleInvoice(45);
    const subA = createSubscription({
      stellar_address: invoiceA.freelancer,
      channel: 'email',
      destination: 'a@example.com',
      triggers: ['invoice_funded'],
    });
    const subB = createSubscription({
      stellar_address: invoiceB.freelancer,
      channel: 'email',
      destination: 'b@example.com',
      triggers: ['invoice_funded'],
    });
    enqueueDispatchAttempt(subA, samplePayload(invoiceA));
    enqueueDispatchAttempt(subB, samplePayload(invoiceB));

    const attempted: number[] = [];
    vi.spyOn(delivery, 'deliverNotification').mockImplementation(async (_sub, payload) => {
      attempted.push(payload.invoice.id);
      if (payload.invoice.id === invoiceA.id) throw new Error('provider 503');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await flushPendingNotifications();

    // Both rows were worked even though the first one threw. Rows created in the
    // same millisecond are ordered by the deterministic `created_at, id`
    // tie-break, so compare the attempts as sets.
    expect([...attempted].sort((a, b) => a - b)).toEqual(
      [invoiceA.id, invoiceB.id].sort((a, b) => a - b)
    );

    const rows = dispatchAttemptRows(db);
    const rowA = rows.find((row) => row.invoice_id === invoiceA.id)!;
    const rowB = rows.find((row) => row.invoice_id === invoiceB.id)!;
    expect(rowA.status).toBe('pending'); // retried by the next poll
    expect(rowA.attempts).toBe(1);
    expect(rowA.last_error).toContain('provider 503');
    expect(rowB.status).toBe('delivered');
    expect(countRows(db, 'sent_notifications')).toBe(1);
    expect(getPendingDispatchAttempts().map((attempt) => attempt.invoice_id)).toEqual([
      invoiceA.id,
    ]);
  });

  it('closes an already-delivered row instead of sending a second copy', async () => {
    // The window a crash can leave behind: the provider received the
    // notification, but the process died before the attempt row moved out of
    // `pending`. The flush must finish the bookkeeping, not re-send.
    const invoice = sampleInvoice(46);
    const subscription = createSubscription({
      stellar_address: invoice.freelancer,
      channel: 'email',
      destination: 'orphan@example.com',
      triggers: ['invoice_funded'],
    });
    enqueueDispatchAttempt(subscription, samplePayload(invoice));
    db.prepare(
      `INSERT INTO sent_notifications
         (invoice_id, trigger, recipient_address, channel, destination, event_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      invoice.id,
      'invoice_funded',
      invoice.freelancer,
      'email',
      'orphan@example.com',
      null,
      Date.now()
    );

    const deliverySpy = vi.spyOn(delivery, 'deliverNotification').mockResolvedValue();

    await flushPendingNotifications();

    expect(deliverySpy).not.toHaveBeenCalled();
    expect(getPendingDispatchAttempts()).toHaveLength(0);
    expect(dispatchAttemptRows(db)[0].status).toBe('delivered');
    expect(countRows(db, 'sent_notifications')).toBe(1);
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function sampleInvoice(id: number): Invoice {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    freelancer: 'GAFREELANCER',
    payer: 'GAPAYER',
    amount: '5000000',
    due_date: now + 86400,
    discount_rate: 100,
    status: 'Funded',
    funder: 'GLP',
    funded_at: now - 3600,
    created_at: now * 1000,
    updated_at: now * 1000,
  };
}

function samplePayload(invoice: Invoice, eventId?: string): NotificationPayload {
  return {
    trigger: 'invoice_funded',
    invoice,
    recipientAddress: invoice.freelancer,
    actor: 'freelancer',
    subject: `Invoice #${invoice.id} funded`,
    message: `Your invoice #${invoice.id} has been funded.`,
    eventId,
  };
}

function fundedEvent(eventId: string, invoiceId: number): any {
  return {
    id: eventId,
    topic: [nativeToScVal('funded')],
    value: nativeToScVal(BigInt(invoiceId)),
    ledger: 1,
    ledgerClosedAt: new Date().toISOString(),
  };
}

/** Read a persisted subscription back out of SQLite, the way the poller does. */
function subscriptionRow(address: string) {
  const row: any = db
    .prepare('SELECT * FROM subscriptions WHERE stellar_address = ? ORDER BY id ASC')
    .get(address);
  return {
    id: row.id,
    stellar_address: row.stellar_address,
    channel: row.channel,
    destination: row.destination,
    triggers: JSON.parse(row.triggers),
    webhook_secret: row.webhook_secret ?? undefined,
    created_at: row.created_at,
  };
}

/** The persisted journal, read straight from SQLite. */
function dispatchAttemptRows(handle: InstanceType<typeof Database>): any[] {
  return handle
    .prepare(
      `SELECT id, dedup_key, invoice_id, trigger, recipient_address, channel, destination,
              event_id, status, attempts, last_error, delivered_at
         FROM dispatch_attempts ORDER BY created_at ASC, id ASC`
    )
    .all() as any[];
}

function countRows(handle: InstanceType<typeof Database>, table: string): number {
  return (handle.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createDb, setDb, insertEvent, upsertInvoice } from '../db';
import { DigestScheduler, type DigestEmailSender, type DigestUserConfig } from '../digest';
import {
  SqliteDigestReconciler,
  getDigestReconciliationMetrics,
  resetDigestReconciliationMetrics,
} from '../digest-reconciliation';
import type { ILNEventType, InvoiceEvent } from '../types';

const FREELANCER = 'GFREELANCER';
const PAYER = 'GPAYER';
const LP = 'GLP';

let db: InstanceType<typeof Database>;
let sender: DigestEmailSender & { calls: Array<{ to: string; subject: string; html: string }> };

function makeSender() {
  const calls: Array<{ to: string; subject: string; html: string }> = [];
  return {
    calls,
    async send(to: string, subject: string, html: string) {
      calls.push({ to, subject, html });
    },
  };
}

function config(overrides: Partial<DigestUserConfig> = {}): DigestUserConfig {
  return {
    stellarAddress: FREELANCER,
    email: 'freelancer@example.com',
    frequency: 'daily',
    sendHour: 8,
    unsubscribeToken: 'unsub',
    ...overrides,
  };
}

function storeInvoice(id: number, funder: string | null = LP) {
  upsertInvoice({
    id,
    freelancer: FREELANCER,
    payer: PAYER,
    amount: '1000000',
    due_date: 1_800_000_000,
    discount_rate: 100,
    status: 'Funded',
    funder,
    funded_at: null,
  });
}

function storeEvent(eventId: string, type: ILNEventType, invoiceId: number, createdAt: number) {
  insertEvent({
    event_id: eventId,
    event_type: type,
    invoice_id: invoiceId,
    ledger: 1,
    ledger_closed_at: new Date(createdAt).toISOString(),
    created_at: createdAt,
  });
}

function invoiceEvent(eventId: string, type: string, invoiceId: number): InvoiceEvent {
  return {
    eventId,
    type,
    invoiceId,
    freelancer: FREELANCER,
    payer: PAYER,
    funder: LP,
    amount: '1000000',
    dueDate: 1_800_000_000,
    discountRate: 100,
  };
}

function newScheduler() {
  return new DigestScheduler(sender, 60_000, { reconciler: new SqliteDigestReconciler() });
}

/** Register at a fixed time so the reconciliation window is deterministic. */
function registerAt(
  scheduler: DigestScheduler,
  at: number,
  overrides: Partial<DigestUserConfig> = {}
) {
  vi.setSystemTime(at);
  scheduler.register(config(overrides));
}

beforeEach(() => {
  vi.useRealTimers();
  db = createDb(':memory:');
  setDb(db);
  sender = makeSender();
  resetDigestReconciliationMetrics();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('digest reconciliation against invoice events (#1282)', () => {
  it('keeps buffered items that match persisted events and records the delivery', async () => {
    vi.useFakeTimers();
    const scheduler = newScheduler();
    registerAt(scheduler, 1_000);
    storeInvoice(1);
    storeEvent('evt-1', 'funded', 1, 900);
    scheduler.buffer(FREELANCER, invoiceEvent('evt-1', 'funded', 1));

    const result = await scheduler.flush(FREELANCER, 5_000);

    expect(result?.itemCount).toBe(1);
    expect(sender.calls[0].html).toContain('#1');
    const delivered = db
      .prepare('SELECT event_id FROM digest_deliveries WHERE stellar_address = ?')
      .all(FREELANCER);
    expect(delivered).toEqual([{ event_id: 'evt-1' }]);
    expect(getDigestReconciliationMetrics().lastReport).toMatchObject({ kept: 1, backfilled: 0 });
  });

  it('drops orphaned items that have no matching invoice event', async () => {
    vi.useFakeTimers();
    const scheduler = newScheduler();
    registerAt(scheduler, 1_000);
    scheduler.buffer(FREELANCER, invoiceEvent('evt-ghost', 'paid', 9));

    const result = await scheduler.flush(FREELANCER, 5_000);

    expect(result?.itemCount).toBe(0);
    expect(sender.calls[0].subject).toContain('No activity');
    expect(getDigestReconciliationMetrics().totals.orphaned).toBe(1);
  });

  it('drops items whose type, invoice or recipient disagree with the event', async () => {
    vi.useFakeTimers();
    const scheduler = newScheduler();
    registerAt(scheduler, 1_000, { stellarAddress: PAYER, email: 'payer@example.com' });
    storeInvoice(1);
    storeInvoice(2);
    storeEvent('evt-type', 'funded', 1, 900);
    storeEvent('evt-invoice', 'funded', 1, 900);
    storeEvent('evt-recipient', 'defaulted', 2, 900); // defaulted → LP only, not the payer

    scheduler.buffer(PAYER, invoiceEvent('evt-type', 'paid', 1));
    scheduler.buffer(PAYER, invoiceEvent('evt-invoice', 'funded', 2));
    scheduler.buffer(PAYER, invoiceEvent('evt-recipient', 'defaulted', 2));

    const result = await scheduler.flush(PAYER, 5_000);

    expect(result?.itemCount).toBe(0);
    expect(getDigestReconciliationMetrics().totals.mismatched).toBe(3);
  });

  it('dedupes replayed events in the buffer and in reconciliation', async () => {
    vi.useFakeTimers();
    const reconciler = new SqliteDigestReconciler();
    const scheduler = new DigestScheduler(sender, 60_000, { reconciler });
    registerAt(scheduler, 1_000);
    storeInvoice(1);
    storeEvent('evt-1', 'funded', 1, 900);

    scheduler.buffer(FREELANCER, invoiceEvent('evt-1', 'funded', 1));
    scheduler.buffer(FREELANCER, invoiceEvent('evt-1', 'funded', 1));
    expect(scheduler.pendingCount(FREELANCER)).toBe(1);

    const item = {
      eventId: 'evt-1',
      invoiceId: 1,
      eventType: 'funded',
      amount: '1',
      freelancer: FREELANCER,
      payer: PAYER,
      dueDate: 0,
      occurredAt: 0,
    };
    const { items, report } = reconciler.reconcileWithReport(
      FREELANCER,
      [item, { ...item }],
      5_000
    );
    expect(items).toHaveLength(1);
    expect(report.duplicates).toBe(1);
  });

  it('backfills events that reached the event store but never the buffer', async () => {
    vi.useFakeTimers();
    const scheduler = newScheduler();
    registerAt(scheduler, 1_000);
    storeInvoice(1);
    storeInvoice(2);
    storeEvent('evt-paid', 'paid', 1, 2_000); // freelancer is a recipient
    storeEvent('evt-default', 'defaulted', 2, 2_500); // LP only — not backfilled

    const result = await scheduler.flush(FREELANCER, 5_000);

    expect(result?.itemCount).toBe(1);
    expect(sender.calls[0].html).toContain('#1');
    expect(getDigestReconciliationMetrics().lastReport).toMatchObject({ backfilled: 1 });
  });

  it('treats the window as (lastFlush, now]: boundary events are not double-counted', async () => {
    vi.useFakeTimers();
    const reconciler = new SqliteDigestReconciler();
    const scheduler = new DigestScheduler(sender, 60_000, { reconciler });
    registerAt(scheduler, 1_000);
    storeInvoice(1);
    storeEvent('evt-at-start', 'paid', 1, 1_000);
    storeEvent('evt-at-end', 'funded', 1, 5_000);

    const { items } = reconciler.reconcileWithReport(FREELANCER, [], 5_000);

    expect(items.map((i) => i.eventId)).toEqual(['evt-at-end']);
  });

  it('restores pending items and registrations after a restart', async () => {
    vi.useFakeTimers();
    const before = newScheduler();
    registerAt(before, 1_000);
    storeInvoice(1);
    storeEvent('evt-1', 'funded', 1, 900);
    before.buffer(FREELANCER, invoiceEvent('evt-1', 'funded', 1));
    before.stop();

    // Process restarts: new scheduler, same database.
    const after = newScheduler();
    expect(after.restore()).toBe(1);
    expect(after.pendingCount(FREELANCER)).toBe(1);

    const result = await after.flush(FREELANCER, 5_000);
    expect(result?.itemCount).toBe(1);
    expect(sender.calls[0].to).toBe('freelancer@example.com');
  });

  it('never re-sends an item after a restart replays it', async () => {
    vi.useFakeTimers();
    const first = newScheduler();
    registerAt(first, 1_000);
    storeInvoice(1);
    storeEvent('evt-1', 'funded', 1, 900);
    first.buffer(FREELANCER, invoiceEvent('evt-1', 'funded', 1));
    await first.flush(FREELANCER, 5_000);

    const second = newScheduler();
    second.restore();
    second.buffer(FREELANCER, invoiceEvent('evt-1', 'funded', 1)); // replayed event
    const result = await second.flush(FREELANCER, 90_000_000);

    expect(result?.itemCount).toBe(0);
    expect(getDigestReconciliationMetrics().totals.alreadyDelivered).toBe(1);
  });

  it('delivers scheduled triggers once even when re-buffered by later passes', async () => {
    vi.useFakeTimers();
    const scheduler = newScheduler();
    registerAt(scheduler, 1_000);
    scheduler.buffer(FREELANCER, invoiceEvent('invoice_due_soon:1', 'invoice_due_soon', 1));
    expect((await scheduler.flush(FREELANCER, 5_000))?.itemCount).toBe(1);

    scheduler.buffer(FREELANCER, invoiceEvent('invoice_due_soon:1', 'invoice_due_soon', 1));
    expect((await scheduler.flush(FREELANCER, 90_000_000))?.itemCount).toBe(0);
  });

  it('holds the watermark before unresolved events and backfills them once resolved', async () => {
    vi.useFakeTimers();
    const scheduler = newScheduler();
    registerAt(scheduler, 1_000);
    storeEvent('evt-late', 'paid', 7, 2_000); // invoice fetch failed — not stored yet

    expect((await scheduler.flush(FREELANCER, 5_000))?.itemCount).toBe(0);
    expect(getDigestReconciliationMetrics().lastReport).toMatchObject({ unresolved: 1 });

    storeInvoice(7);
    const result = await scheduler.flush(FREELANCER, 90_000_000);
    expect(result?.itemCount).toBe(1);
    expect(getDigestReconciliationMetrics().lastReport).toMatchObject({
      backfilled: 1,
      unresolved: 0,
    });
  });

  it('fails closed when the event store is unavailable: nothing sent, buffer kept', async () => {
    vi.useFakeTimers();
    const scheduler = newScheduler();
    registerAt(scheduler, 1_000);
    scheduler.buffer(FREELANCER, invoiceEvent('evt-1', 'funded', 1));
    db.close();

    await expect(scheduler.flush(FREELANCER, 5_000)).rejects.toThrow();
    expect(sender.calls).toHaveLength(0);
    expect(scheduler.pendingCount(FREELANCER)).toBe(1);
    expect(getDigestReconciliationMetrics().failures).toBe(1);
  });

  it('exposes cumulative reconciliation counters for GET /metrics/digest-reconciliation', async () => {
    vi.useFakeTimers();
    const scheduler = newScheduler();
    registerAt(scheduler, 1_000);
    scheduler.buffer(FREELANCER, invoiceEvent('evt-ghost', 'paid', 9));
    await scheduler.flush(FREELANCER, 5_000);

    expect(getDigestReconciliationMetrics()).toMatchObject({
      control: 'digest-reconciliation-against-invoice-events',
      runs: 1,
      failures: 0,
      totals: { orphaned: 1 },
    });
  });
});

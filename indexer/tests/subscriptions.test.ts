import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, setDb, upsertInvoice } from '../src/db';
import { resolvers, filterInvoiceUpdated, filterEventStream } from '../src/graphql/resolvers';
import { pubsub, INVOICE_UPDATED, EVENT_STREAM } from '../src/graphql/pubsub';
import { typeDefs } from '../src/graphql/schema';
import type { Invoice, ILNEvent } from '../src/types';
import type { InvoiceUpdatedPayload, EventStreamPayload } from '../src/graphql/pubsub';
import type { InvoiceUpdatedArgs, EventStreamArgs } from '../src/graphql/resolvers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const G1 = 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR';
const G2 = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';
const G3 = 'GDNA2SBLDTGZICXNPQ5SIQFYBDP7WGLXSLKQFQYQRXLWSMQWMFWVHP2';
const GOTHER = 'GAOJJQB6RJQJKPQBZ7DFRHLKKSMAFUNP3MK5Y6UFSRCFCYUQ5VXALOE';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 1,
    freelancer: G1,
    payer: G2,
    amount: '100000000',
    due_date: 9_999_999_999,
    discount_rate: 300,
    status: 'Pending',
    funder: null,
    funded_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ILNEvent> = {}): ILNEvent {
  return {
    event_id: 'evt-1',
    event_type: 'submitted',
    invoice_id: 1,
    ledger: 12345,
    ledger_closed_at: new Date().toISOString(),
    created_at: Date.now(),
    ...overrides,
  };
}

function makeInvoicePayload(inv: Invoice, event?: Partial<ILNEvent>): InvoiceUpdatedPayload {
  return { invoiceUpdated: inv, triggeringEvent: makeEvent(event) };
}

function makeEventPayload(event: Partial<ILNEvent> = {}): EventStreamPayload {
  return { eventStream: makeEvent(event) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setDb(createDb(':memory:'));
});

// ── Schema structure ──────────────────────────────────────────────────────────

describe('schema structure', () => {
  it('typeDefs include invoiceUpdated subscription field', () => {
    expect(typeDefs).toContain('invoiceUpdated');
  });

  it('typeDefs include eventStream subscription field', () => {
    expect(typeDefs).toContain('eventStream');
  });

  it('typeDefs include Invoice type', () => {
    expect(typeDefs).toContain('type Invoice');
  });

  it('typeDefs include ILNEvent type', () => {
    expect(typeDefs).toContain('type ILNEvent');
  });

  it('resolvers expose invoiceUpdated subscription', () => {
    expect(resolvers.Subscription.invoiceUpdated).toBeDefined();
    expect(typeof resolvers.Subscription.invoiceUpdated.subscribe).toBe('function');
    expect(typeof resolvers.Subscription.invoiceUpdated.resolve).toBe('function');
  });

  it('resolvers expose eventStream subscription', () => {
    expect(resolvers.Subscription.eventStream).toBeDefined();
    expect(typeof resolvers.Subscription.eventStream.subscribe).toBe('function');
    expect(typeof resolvers.Subscription.eventStream.resolve).toBe('function');
  });
});

// ── Query resolvers ───────────────────────────────────────────────────────────

describe('Query.invoice resolver', () => {
  it('returns null for an unknown id', () => {
    const result = resolvers.Query.invoice(undefined, { id: 999 });
    expect(result).toBeNull();
  });

  it('returns the invoice for a known id', () => {
    upsertInvoice(makeInvoice({ id: 5 }));
    const result = resolvers.Query.invoice(undefined, { id: 5 }) as Invoice;
    expect(result.id).toBe(5);
    expect(result.status).toBe('Pending');
  });
});

describe('Query.invoices resolver', () => {
  it('returns all invoices when no filters applied', () => {
    upsertInvoice(makeInvoice({ id: 1 }));
    upsertInvoice(makeInvoice({ id: 2 }));
    const result = resolvers.Query.invoices(undefined, {});
    expect(result.invoices).toHaveLength(2);
    expect(result.hasMore).toBe(false);
  });

  it('caps limit at 100', () => {
    const result = resolvers.Query.invoices(undefined, { limit: 9999 });
    expect(result.invoices).toHaveLength(0);
  });

  it('filters by status', () => {
    upsertInvoice(makeInvoice({ id: 1, status: 'Pending' }));
    upsertInvoice(makeInvoice({ id: 2, status: 'Funded', funder: G3, funded_at: Date.now() }));
    const result = resolvers.Query.invoices(undefined, { status: 'Funded' });
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].status).toBe('Funded');
  });
});

describe('Query.stats resolver', () => {
  it('returns protocol statistics', () => {
    upsertInvoice(makeInvoice({ id: 1 }));
    const result = resolvers.Query.stats();
    expect(result.totalInvoices).toBe(1);
    expect(typeof result.totalVolume).toBe('string');
  });
});

// ── Field resolvers ───────────────────────────────────────────────────────────

describe('Invoice field resolvers', () => {
  it('dueDate maps from due_date', () => {
    const inv = makeInvoice({ due_date: 1700000000 });
    expect(resolvers.Invoice.dueDate(inv)).toBe(1700000000);
  });

  it('discountRate maps from discount_rate', () => {
    const inv = makeInvoice({ discount_rate: 500 });
    expect(resolvers.Invoice.discountRate(inv)).toBe(500);
  });

  it('fundedAt maps from funded_at', () => {
    const inv = makeInvoice({ funded_at: 1700000001 });
    expect(resolvers.Invoice.fundedAt(inv)).toBe(1700000001);
  });
});

describe('ILNEvent field resolvers', () => {
  it('eventId maps from event_id', () => {
    const ev = makeEvent({ event_id: 'abc-123' });
    expect(resolvers.ILNEvent.eventId(ev)).toBe('abc-123');
  });

  it('eventType maps from event_type', () => {
    const ev = makeEvent({ event_type: 'funded' });
    expect(resolvers.ILNEvent.eventType(ev)).toBe('funded');
  });

  it('invoiceId maps from invoice_id', () => {
    const ev = makeEvent({ invoice_id: 42 });
    expect(resolvers.ILNEvent.invoiceId(ev)).toBe(42);
  });
});

// ── Subscription filter: invoiceUpdated ──────────────────────────────────────

describe('filterInvoiceUpdated', () => {
  it('passes all updates when no filters set', () => {
    const payload = makeInvoicePayload(makeInvoice());
    expect(filterInvoiceUpdated(payload, {})).toBe(true);
  });

  it('passes when id matches', () => {
    const payload = makeInvoicePayload(makeInvoice({ id: 5 }));
    expect(filterInvoiceUpdated(payload, { id: 5 })).toBe(true);
  });

  it('blocks when id does not match', () => {
    const payload = makeInvoicePayload(makeInvoice({ id: 1 }));
    expect(filterInvoiceUpdated(payload, { id: 99 })).toBe(false);
  });

  it('passes when status matches', () => {
    const payload = makeInvoicePayload(makeInvoice({ status: 'Funded' }));
    expect(filterInvoiceUpdated(payload, { status: 'Funded' })).toBe(true);
  });

  it('blocks when status does not match', () => {
    const payload = makeInvoicePayload(makeInvoice({ status: 'Pending' }));
    expect(filterInvoiceUpdated(payload, { status: 'Funded' })).toBe(false);
  });

  it('passes when freelancer matches', () => {
    const payload = makeInvoicePayload(makeInvoice({ freelancer: G1 }));
    expect(filterInvoiceUpdated(payload, { freelancer: G1 })).toBe(true);
  });

  it('blocks when freelancer does not match', () => {
    const payload = makeInvoicePayload(makeInvoice({ freelancer: G1 }));
    expect(filterInvoiceUpdated(payload, { freelancer: GOTHER })).toBe(false);
  });

  it('passes when payer matches', () => {
    const payload = makeInvoicePayload(makeInvoice({ payer: G2 }));
    expect(filterInvoiceUpdated(payload, { payer: G2 })).toBe(true);
  });

  it('blocks when payer does not match', () => {
    const payload = makeInvoicePayload(makeInvoice({ payer: G2 }));
    expect(filterInvoiceUpdated(payload, { payer: GOTHER })).toBe(false);
  });

  it('passes when funder matches', () => {
    const payload = makeInvoicePayload(makeInvoice({ funder: G3 }));
    expect(filterInvoiceUpdated(payload, { funder: G3 })).toBe(true);
  });

  it('blocks when funder does not match', () => {
    const payload = makeInvoicePayload(makeInvoice({ funder: G3 }));
    expect(filterInvoiceUpdated(payload, { funder: GOTHER })).toBe(false);
  });

  it('ANDs multiple filters — passes when all match', () => {
    const payload = makeInvoicePayload(makeInvoice({ id: 1, status: 'Funded', freelancer: G1 }));
    expect(filterInvoiceUpdated(payload, { id: 1, status: 'Funded', freelancer: G1 })).toBe(true);
  });

  it('ANDs multiple filters — blocks when one fails', () => {
    const payload = makeInvoicePayload(makeInvoice({ id: 1, status: 'Pending', freelancer: G1 }));
    expect(filterInvoiceUpdated(payload, { id: 1, status: 'Funded' })).toBe(false);
  });
});

// ── Subscription filter: eventStream ─────────────────────────────────────────

describe('filterEventStream', () => {
  it('passes all events when no filters set', () => {
    const payload = makeEventPayload();
    expect(filterEventStream(payload, {})).toBe(true);
  });

  it('passes when invoiceId matches', () => {
    const payload = makeEventPayload({ invoice_id: 5 });
    expect(filterEventStream(payload, { invoiceId: 5 })).toBe(true);
  });

  it('blocks when invoiceId does not match', () => {
    const payload = makeEventPayload({ invoice_id: 5 });
    expect(filterEventStream(payload, { invoiceId: 99 })).toBe(false);
  });

  it('passes when eventType matches', () => {
    const payload = makeEventPayload({ event_type: 'funded' });
    expect(filterEventStream(payload, { eventType: 'funded' })).toBe(true);
  });

  it('blocks when eventType does not match', () => {
    const payload = makeEventPayload({ event_type: 'submitted' });
    expect(filterEventStream(payload, { eventType: 'funded' })).toBe(false);
  });

  it('ANDs invoiceId and eventType — passes when both match', () => {
    const payload = makeEventPayload({ invoice_id: 5, event_type: 'paid' });
    expect(filterEventStream(payload, { invoiceId: 5, eventType: 'paid' })).toBe(true);
  });

  it('ANDs invoiceId and eventType — blocks when only one matches', () => {
    const payload = makeEventPayload({ invoice_id: 5, event_type: 'funded' });
    expect(filterEventStream(payload, { invoiceId: 5, eventType: 'paid' })).toBe(false);
  });
});

// ── PubSub integration ────────────────────────────────────────────────────────

describe('PubSub integration', () => {
  it('INVOICE_UPDATED asyncIterator yields published payload', async () => {
    const iter = pubsub.asyncIterableIterator<InvoiceUpdatedPayload>(INVOICE_UPDATED);
    const inv = makeInvoice({ id: 42, status: 'Funded' });
    const ev = makeEvent({ event_type: 'funded' });

    // Start next() first so the subscription is registered, then publish
    // in the next I/O tick (after all pending microtasks have settled).
    const nextPromise = iter.next();
    setImmediate(() =>
      pubsub.publish(INVOICE_UPDATED, { invoiceUpdated: inv, triggeringEvent: ev })
    );

    const { value } = await nextPromise;
    expect(value.invoiceUpdated.id).toBe(42);
    expect(value.invoiceUpdated.status).toBe('Funded');
    expect(value.triggeringEvent.event_type).toBe('funded');

    iter.return?.();
  });

  it('EVENT_STREAM asyncIterator yields published event', async () => {
    const iter = pubsub.asyncIterableIterator<EventStreamPayload>(EVENT_STREAM);
    const ev = makeEvent({ event_id: 'stream-test', event_type: 'defaulted', invoice_id: 7 });

    const nextPromise = iter.next();
    setImmediate(() => pubsub.publish(EVENT_STREAM, { eventStream: ev }));

    const { value } = await nextPromise;
    expect(value.eventStream.event_id).toBe('stream-test');
    expect(value.eventStream.event_type).toBe('defaulted');
    expect(value.eventStream.invoice_id).toBe(7);

    iter.return?.();
  });

  it('Subscription.invoiceUpdated resolve extracts invoice from payload', () => {
    const inv = makeInvoice({ id: 10 });
    const payload = makeInvoicePayload(inv);
    const result = resolvers.Subscription.invoiceUpdated.resolve(payload);
    expect(result).toBe(inv);
  });

  it('Subscription.eventStream resolve extracts event from payload', () => {
    const ev = makeEvent({ event_id: 'resolve-test' });
    const payload = { eventStream: ev };
    const result = resolvers.Subscription.eventStream.resolve(payload);
    expect(result).toBe(ev);
  });
});

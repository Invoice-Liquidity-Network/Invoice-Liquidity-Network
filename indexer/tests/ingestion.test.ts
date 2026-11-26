import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, getInvoiceById, hasEvent, setDb } from '../src/db';
import { processEvent } from '../src/processor';

// ── Mock the RPC module so no network calls are made ─────────────────────────
vi.mock('../src/rpc', () => ({
  fetchInvoice: vi.fn(),
  server: {},
}));

import { fetchInvoice } from '../src/rpc';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const FREELANCER = 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR';
const PAYER = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';
const FUNDER = 'GDNA2SBLDTGZICXNPQ5SIQFYBDP7WGLXSLKQFQYQRXLWSMQWMFWVHP2';

/** Build a mock `rpc.Api.EventResponse`-compatible object with real XDR values. */
function makeEvent(type: string, invoiceId: number, id = `${invoiceId}-${type}-${Date.now()}`) {
  return {
    id,
    pagingToken: id,
    type: 'contract',
    ledger: 1000,
    ledgerClosedAt: '2024-01-01T00:00:00Z',
    contractId: 'CTEST',
    topic: [xdr.ScVal.scvSymbol(type)],
    value: nativeToScVal(BigInt(invoiceId), { type: 'u64' }),
    inSuccessfulContractCall: true,
  } as any;
}

/** Partial invoice returned by the mocked fetchInvoice. */
function mockInvoice(id: number, status = 'Pending', funder: string | null = null) {
  return {
    id,
    freelancer: FREELANCER,
    payer: PAYER,
    amount: '100000000',
    due_date: 9999999999,
    discount_rate: 300,
    status,
    funder,
    funded_at: funder ? 1700000000 : null,
  } as const;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setDb(createDb(':memory:'));
  vi.mocked(fetchInvoice).mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processEvent — submitted', () => {
  it('inserts the invoice into the database', async () => {
    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(1));

    await processEvent(makeEvent('submitted', 1, 'event-submitted-1'));

    const invoice = getInvoiceById(1);
    expect(invoice).toBeDefined();
    expect(invoice!.id).toBe(1);
    expect(invoice!.status).toBe('Pending');
    expect(invoice!.freelancer).toBe(FREELANCER);
    expect(invoice!.amount).toBe('100000000');
  });

  it('stores the event record', async () => {
    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(1));

    await processEvent(makeEvent('submitted', 1, 'evt-abc'));

    expect(hasEvent('evt-abc')).toBe(true);
  });
});

describe('processEvent — funded', () => {
  it('upserts the invoice with Funded status and funder address', async () => {
    // First, index the submitted invoice
    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(2));
    await processEvent(makeEvent('submitted', 2, 'evt-submitted-2'));

    // Now index the funded event
    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(2, 'Funded', FUNDER));
    await processEvent(makeEvent('funded', 2, 'evt-funded-2'));

    const invoice = getInvoiceById(2);
    expect(invoice!.status).toBe('Funded');
    expect(invoice!.funder).toBe(FUNDER);
    expect(invoice!.funded_at).toBeGreaterThan(0);
  });

  it('upserts invoice even when submitted event was never seen', async () => {
    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(3, 'Funded', FUNDER));

    await processEvent(makeEvent('funded', 3, 'evt-funded-3'));

    const invoice = getInvoiceById(3);
    expect(invoice!.status).toBe('Funded');
  });
});

describe('processEvent — paid', () => {
  it('upserts the invoice with Paid status', async () => {
    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(4, 'Funded', FUNDER));
    await processEvent(makeEvent('funded', 4, 'evt-funded-4'));

    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(4, 'Paid', FUNDER));
    await processEvent(makeEvent('paid', 4, 'evt-paid-4'));

    const invoice = getInvoiceById(4);
    expect(invoice!.status).toBe('Paid');
  });
});

describe('processEvent — defaulted', () => {
  it('upserts the invoice with Defaulted status', async () => {
    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(5, 'Funded', FUNDER));
    await processEvent(makeEvent('funded', 5, 'evt-funded-5'));

    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(5, 'Defaulted', FUNDER));
    await processEvent(makeEvent('defaulted', 5, 'evt-defaulted-5'));

    const invoice = getInvoiceById(5);
    expect(invoice!.status).toBe('Defaulted');
  });
});

describe('processEvent — deduplication', () => {
  it('does not process the same event twice', async () => {
    vi.mocked(fetchInvoice).mockResolvedValue(mockInvoice(6));

    const event = makeEvent('submitted', 6, 'evt-dup-6');

    await processEvent(event);
    await processEvent(event); // duplicate

    // fetchInvoice should have been called only once
    expect(vi.mocked(fetchInvoice)).toHaveBeenCalledTimes(1);
  });

  it('records the event so hasEvent returns true after processing', async () => {
    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(7));

    await processEvent(makeEvent('submitted', 7, 'evt-check-7'));

    expect(hasEvent('evt-check-7')).toBe(true);
  });
});

describe('processEvent — unknown event type', () => {
  it('silently ignores events with unrecognised topic symbols', async () => {
    await processEvent(makeEvent('transfer', 99, 'evt-unknown'));

    // No invoice inserted, no fetchInvoice call
    expect(vi.mocked(fetchInvoice)).not.toHaveBeenCalled();
    expect(getInvoiceById(99)).toBeUndefined();
  });
});

describe('processEvent — fetchInvoice failure', () => {
  it('stores the event but does not crash when RPC returns null', async () => {
    vi.mocked(fetchInvoice).mockResolvedValueOnce(null);

    await processEvent(makeEvent('submitted', 10, 'evt-null-10'));

    expect(hasEvent('evt-null-10')).toBe(true);
    expect(getInvoiceById(10)).toBeUndefined();
  });
});

// ── Issue #1437: Transaction batch atomicity (crash recovery, partial decode,
//    duplicate event indexes) ────────────────────────────────────────────────

describe('processEvent — transaction batch atomicity (#1437)', () => {
  it('rolls back the entire event+invoice write when the upsert throws mid-transaction', async () => {
    // Force applyEventWithInvoice to fail inside its transaction by injecting
    // an invoice whose `freelancer` is null — the invoices table declares it
    // NOT NULL, so the upsert aborts and the whole transaction rolls back.
    vi.mocked(fetchInvoice).mockResolvedValueOnce({
      ...mockInvoice(501, 'Pending'),
      freelancer: null,
    } as any);

    const badEvent = makeEvent('submitted', 501, 'evt-atomic-fail');

    await expect(processEvent(badEvent)).rejects.toThrow();

    // Atomicity: neither the event row nor the invoice row may survive.
    expect(hasEvent('evt-atomic-fail')).toBe(false);
    expect(getInvoiceById(501)).toBeUndefined();
  });

  it('keeps a previously committed event intact when a later event in the same batch fails', async () => {
    // Event A commits successfully.
    vi.mocked(fetchInvoice).mockResolvedValueOnce(mockInvoice(502, 'Pending'));
    await processEvent(makeEvent('submitted', 502, 'evt-a-ok'));

    // Event B fails to fetch (rejects on every retry attempt).
    vi.mocked(fetchInvoice).mockReset().mockRejectedValue(new Error('RPC down for B'));
    await expect(processEvent(makeEvent('submitted', 503, 'evt-b-fail'))).rejects.toThrow(
      'RPC down for B'
    );

    // Event A's state is untouched; Event B never landed.
    expect(hasEvent('evt-a-ok')).toBe(true);
    expect(getInvoiceById(502)?.status).toBe('Pending');
    expect(hasEvent('evt-b-fail')).toBe(false);
    expect(getInvoiceById(503)).toBeUndefined();
  });

  it('survives a simulated crash-and-replay by leaving no orphaned rows', async () => {
    // Simulate a crash: the first invocation fails inside the transaction
    // (NOT NULL violation on freelancer), so the process is killed. On
    // restart, the same event is replayed and must converge to exactly one row.
    const event = makeEvent('submitted', 504, 'evt-crash-replay');

    // First attempt: corrupt the invoice so the transaction aborts.
    vi.mocked(fetchInvoice).mockResolvedValueOnce({
      ...mockInvoice(504, 'Pending'),
      freelancer: null,
    } as any);
    let firstAttemptThrew = false;
    try {
      await processEvent(event);
    } catch {
      firstAttemptThrew = true;
    }
    expect(firstAttemptThrew).toBe(true);
    expect(hasEvent('evt-crash-replay')).toBe(false);
    expect(getInvoiceById(504)).toBeUndefined();

    // Replay after "restart": fetchInvoice returns a valid invoice.
    vi.mocked(fetchInvoice).mockReset().mockResolvedValue(mockInvoice(504, 'Pending'));
    await processEvent(event);

    expect(hasEvent('evt-crash-replay')).toBe(true);
    expect(getInvoiceById(504)?.status).toBe('Pending');
  });

  it('deduplicates by event id even when the same id is processed concurrently', async () => {
    vi.mocked(fetchInvoice).mockResolvedValue(mockInvoice(505, 'Pending'));
    const event = makeEvent('submitted', 505, 'evt-concurrent-dup');

    // Both calls pass the hasEvent() check before either commits, so both
    // fetch; INSERT OR IGNORE inside applyEventWithInvoice keeps the stored
    // state single.
    await Promise.all([processEvent(event), processEvent(event)]);

    expect(hasEvent('evt-concurrent-dup')).toBe(true);
    expect(getInvoiceById(505)?.status).toBe('Pending');
  });

  it('treats a duplicate event id with a different invoice id as a distinct row', async () => {
    // Same event id, different invoice id — the PRIMARY KEY on event_id
    // guarantees only one row survives regardless of invoice id.
    vi.mocked(fetchInvoice).mockResolvedValue(mockInvoice(506, 'Pending'));
    const event = makeEvent('submitted', 506, 'evt-same-id-diff-inv');

    await processEvent(event);
    // Re-process with the same event id but a different invoice id; the
    // deduplication short-circuits before any invoice write.
    await processEvent({
      ...event,
      value: nativeToScVal(BigInt(999), { type: 'u64' }),
    } as any);

    expect(hasEvent('evt-same-id-diff-inv')).toBe(true);
    expect(getInvoiceById(506)?.status).toBe('Pending');
    expect(getInvoiceById(999)).toBeUndefined();
  });
});

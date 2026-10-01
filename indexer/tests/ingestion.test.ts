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

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  setDb,
  recordLedgerHash,
  getRecordedHash,
  getRecordedHashes,
  getCursorLedger,
  setCursorLedger,
  latestKnownLedger,
  latestConfirmedLedger,
  invoiceIsProvisional,
  insertEvent,
  upsertInvoice,
  getEvents,
  getInvoiceById,
} from '../src/db';
import { detectReorg, rollBackFromReorg } from '../src/reorg';

const FREELANCER = 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR';
const PAYER = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';

beforeEach(() => {
  setDb(createDb(':memory:'));
});

describe('detectReorg', () => {
  it('returns no reorg when every recorded hash still matches canonical', async () => {
    const recorded = [
      { ledger: 1, hash: 'h1' },
      { ledger: 2, hash: 'h2' },
      { ledger: 3, hash: 'h3' },
    ];
    const lookups = new Map(recorded.map((r) => [r.ledger, r.hash]));

    const result = await detectReorg(recorded, (ledger) => lookups.get(ledger) ?? null);
    expect(result).toEqual({ reorged: false, lca: 3 });
  });

  it('finds the LCA when the chain diverges mid-way', async () => {
    const recorded = [
      { ledger: 1, hash: 'h1' },
      { ledger: 2, hash: 'h2' },
      { ledger: 3, hash: 'h3' },
      { ledger: 4, hash: 'h4' },
    ];
    const canonical = new Map([
      [1, 'h1'],
      [2, 'h2'],
      [3, 'CONFLICTING'],
      [4, 'h4'],
    ]);

    const result = await detectReorg(recorded, (ledger) => canonical.get(ledger) ?? null);
    expect(result.reorged).toBe(true);
    expect(result.lca).toBe(2);
  });

  it('treats an unavailable canonical hash as a divergence', async () => {
    const recorded = [
      { ledger: 1, hash: 'h1' },
      { ledger: 2, hash: 'h2' },
    ];
    const result = await detectReorg(recorded, () => null);
    expect(result).toEqual({ reorged: true, lca: 0 });
  });

  it('sorts input regardless of order', async () => {
    const recorded = [
      { ledger: 3, hash: 'h3' },
      { ledger: 1, hash: 'h1' },
      { ledger: 2, hash: 'h2' },
    ];
    const canonical = new Map([
      [1, 'h1'],
      [2, 'DIFF'],
      [3, 'h3'],
    ]);
    const result = await detectReorg(recorded, (ledger) => canonical.get(ledger) ?? null);
    expect(result).toEqual({ reorged: true, lca: 1 });
  });
});

describe('rollBackFromReorg', () => {
  function seedState(): void {
    // hashes for ledgers 1..5
    for (let ledger = 1; ledger <= 5; ledger++) {
      recordLedgerHash(ledger, `hash-${ledger}`);
    }
    // one event + invoice per ledger
    for (let ledger = 1; ledger <= 5; ledger++) {
      insertEvent({
        event_id: `e-${ledger}`,
        event_type: 'submitted',
        invoice_id: ledger,
        ledger,
        ledger_closed_at: '2024-01-01T00:00:00Z',
        created_at: 1700000000000,
        confirmed: true,
      });
      upsertInvoice({
        id: ledger,
        freelancer: FREELANCER,
        payer: PAYER,
        amount: '1000',
        due_date: 9999999999,
        discount_rate: 300,
        status: 'Pending',
        funder: null,
        funded_at: null,
      });
    }
    // cursor advanced to the highest recorded hash via rollback contract
  }

  it('detects divergence, rolls back state, and resets the cursor to the LCA', async () => {
    seedState();
    setCursorLedger(5);

    // Simulate a reorg that invalidates ledgers 3, 4, 5:
    // ledger 3 now has a different hash on the canonical chain, ledger 5 is gone.
    const canonical = (ledger: number) => {
      if (ledger === 3) return 'hash-3-FORKED';
      if (ledger === 1 || ledger === 2) return `hash-${ledger}`;
      return null;
    };

    const detection = await rollBackFromReorg(canonical, 0);

    expect(detection).toEqual({ reorged: true, lca: 2 });
    expect(getCursorLedger()).toBe(2);

    // Events at/above the divergent ledger are deleted, older ones survive.
    const remaining = getEvents();
    expect(remaining.map((e) => e.event_id).sort()).toEqual(['e-1', 'e-2']);

    // Affected invoices are removed so they are re-derived on replay.
    expect(getInvoiceById(3)).toBeUndefined();
    expect(getInvoiceById(5)).toBeUndefined();
    expect(getInvoiceById(1)).toBeDefined();

    // Reorged ledger hashes are dropped; the LCA and below survive.
    const hashes = getRecordedHashes()
      .map((h) => h.ledger)
      .sort();
    expect(hashes).toEqual([1, 2]);
    expect(getRecordedHash(2)).toBe('hash-2');
  });

  it('does nothing when the recorded chain is still canonical', async () => {
    seedState();
    setCursorLedger(5);

    const canonical = (ledger: number) => `hash-${ledger}`;
    const detection = await rollBackFromReorg(canonical, 0);

    expect(detection.reorged).toBe(false);
    expect(getCursorLedger()).toBe(5);
    expect(getEvents()).toHaveLength(5);
  });

  it('respects the fromLedger window (only re-verify recent hashes)', async () => {
    seedState();
    const canonical = (ledger: number) => (ledger === 3 ? 'hash-3-FORKED' : `hash-${ledger}`);

    const detection = await rollBackFromReorg(canonical, 2);

    expect(detection).toEqual({ reorged: true, lca: 2 });
  });
});

describe('confirmation policy', () => {
  it('computes the confirmed boundary from the latest known ledger', () => {
    recordLedgerHash(100, 'h100');
    expect(latestKnownLedger()).toBe(100);
    expect(latestConfirmedLedger(10)).toBe(90);
    expect(latestConfirmedLedger(0)).toBe(100);
  });

  it('marks invoices with events inside the confirmation window as provisional', () => {
    insertEvent({
      event_id: 'p-1',
      event_type: 'submitted',
      invoice_id: 7,
      ledger: 95,
      ledger_closed_at: '2024-01-01T00:00:00Z',
      created_at: 1700000000000,
      confirmed: false,
    });
    insertEvent({
      event_id: 'p-2',
      event_type: 'submitted',
      invoice_id: 8,
      ledger: 90,
      ledger_closed_at: '2024-01-01T00:00:00Z',
      created_at: 1700000000000,
      confirmed: true,
    });
    // tip at 100, depth 10 → confirmed boundary 90.
    recordLedgerHash(100, 'h100');

    expect(invoiceIsProvisional(7, 10)).toBe(true); // ledger 95 > 90
    expect(invoiceIsProvisional(8, 10)).toBe(false); // ledger 90 <= 90
  });
});

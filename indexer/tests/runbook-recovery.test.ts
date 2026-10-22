import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  getCursorLedger,
  insertEvent,
  rollbackToLedger,
  setCursorLedger,
  setDb,
  upsertInvoice,
} from '../src/db';

/**
 * Pins the recovery primitives named in
 * docs/indexer/cursor-divergence-recovery.md ("Manual Cursor Reset & Re-sync").
 * If these semantics change, the runbook must change with them.
 */

const G1 = 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR';
const G2 = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';

beforeEach(() => {
  setDb(createDb(':memory:'));
});

describe('cursor divergence runbook — manual reset', () => {
  it('setCursorLedger refuses to rewind (the runbook must not use it)', () => {
    setCursorLedger(5_000);
    expect(() => setCursorLedger(4_500)).toThrow(/Cursor monotonicity violation/);
    expect(getCursorLedger()).toBe(5_000);
  });

  it('rollbackToLedger rewinds the cursor and removes events above the target', () => {
    const now = Date.now();
    upsertInvoice({
      id: 1,
      freelancer: G1,
      payer: G2,
      amount: '100',
      due_date: 9_999_999_999,
      discount_rate: 300,
      status: 'Pending',
      funder: null,
      funded_at: null,
    });
    insertEvent({
      event_id: 'keep',
      event_type: 'submitted',
      invoice_id: 1,
      ledger: 4_400,
      ledger_closed_at: new Date(now).toISOString(),
      created_at: now,
    });
    insertEvent({
      event_id: 'drop',
      event_type: 'submitted',
      invoice_id: 1,
      ledger: 4_900,
      ledger_closed_at: new Date(now).toISOString(),
      created_at: now,
    });
    setCursorLedger(5_000);

    const result = rollbackToLedger(4_500);

    expect(getCursorLedger()).toBe(4_500);
    expect(result.eventsRemoved).toBe(1);
  });

  it('is idempotent: repeating the reset (operator retry) changes nothing further', () => {
    setCursorLedger(5_000);
    rollbackToLedger(4_500);
    const again = rollbackToLedger(4_500);
    expect(getCursorLedger()).toBe(4_500);
    expect(again.eventsRemoved).toBe(0);
  });
});

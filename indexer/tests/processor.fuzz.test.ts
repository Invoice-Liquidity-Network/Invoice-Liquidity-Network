import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, getDb, getInvoiceById, setDb } from '../src/db';
import { decodeEvent, isValidInvoiceState } from '../src/decode';
import { countDeadLetters, listDeadLetters, serializeEventPayload } from '../src/deadLetter';
import { processEvent } from '../src/processor';
import {
  eventArb,
  invoiceScriptArb,
  materialize,
  validInvoice,
  type InvoiceScript,
  type RawEventShape,
} from './fuzz/arbitraries';
import { persistCounterexample } from './fuzz/corpus';

vi.mock('../src/rpc', () => ({ fetchInvoice: vi.fn(), server: {} }));
vi.mock('../src/cache', () => ({ invalidateInvoiceCache: vi.fn().mockResolvedValue(undefined) }));
import { fetchInvoice } from '../src/rpc';

/**
 * Property-based fuzzing of the indexer's event-processing layer.
 *
 * Budget: FUZZ_RUNS runs per property (default 300 locally and on PRs; the
 * nightly workflow uses 5000). FUZZ_SEED pins the generator for reproduction.
 * Any counterexample is persisted to tests/fuzz-corpus/ and replayed by
 * processor.corpus.test.ts from then on.
 */
const NUM_RUNS = Number(process.env.FUZZ_RUNS ?? 300);
const SEED = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : undefined;

function scriptInvoice(script: InvoiceScript): void {
  vi.mocked(fetchInvoice).mockReset();
  switch (script.kind) {
    case 'null':
      vi.mocked(fetchInvoice).mockResolvedValue(null);
      break;
    case 'valid':
      vi.mocked(fetchInvoice).mockImplementation(
        async (id: number) => validInvoice(id, script.status) as never
      );
      break;
    case 'malformed':
      vi.mocked(fetchInvoice).mockResolvedValue(script.value as never);
      break;
    case 'throw':
      vi.mocked(fetchInvoice).mockRejectedValue(new Error('rpc unavailable'));
      break;
  }
}

function snapshot() {
  const db = getDb();
  return {
    events: db.prepare('SELECT * FROM events ORDER BY event_id').all(),
    invoices: db.prepare('SELECT * FROM invoices ORDER BY id').all(),
    deadLetters: countDeadLetters(),
  };
}

/** Runs a property and persists the counterexample before rethrowing. */
async function check(
  property: string,
  predicate: (shape: RawEventShape, invoice: InvoiceScript) => Promise<void>
) {
  let current: { shape: RawEventShape; invoice: InvoiceScript } | null = null;
  try {
    await fc.assert(
      fc.asyncProperty(eventArb, invoiceScriptArb, async (shape, invoice) => {
        current = { shape, invoice };
        setDb(createDb(':memory:'));
        scriptInvoice(invoice);
        await predicate(shape, invoice);
      }),
      { numRuns: NUM_RUNS, seed: SEED, endOnFailure: true }
    );
  } catch (error) {
    if (current) {
      const file = persistCounterexample(property, current.shape, current.invoice, error);
      console.error(`[fuzz] counterexample for "${property}" persisted to ${file}`);
    }
    throw error;
  }
}

describe('indexer event processing — property-based fuzzing', () => {
  beforeEach(() => {
    setDb(createDb(':memory:'));
  });

  it('decodeEvent is total: never throws for any input', () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), eventArb.map(materialize)), (input) => {
        const decoded = decodeEvent(input);
        expect(['ok', 'ignored', 'malformed']).toContain(decoded.kind);
      }),
      { numRuns: NUM_RUNS, seed: SEED }
    );
  });

  it('serializeEventPayload never throws and always yields JSON', () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), eventArb.map(materialize)), (input) => {
        const json = serializeEventPayload(input);
        expect(() => JSON.parse(json)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, seed: SEED }
    );
  });

  it('never throws for any event shape while the database is healthy (RPC exceptions excepted)', async () => {
    await check('no-crash', async (shape, invoice) => {
      const event = materialize(shape);
      const decoded = decodeEvent(event);
      const pending = processEvent(event as never);
      if (invoice.kind === 'throw' && decoded.kind === 'ok') {
        // Infrastructure failure propagates to the poller, but must leave no partial state behind.
        await expect(pending).rejects.toThrow('rpc unavailable');
        expect(snapshot()).toEqual({ events: [], invoices: [], deadLetters: 0 });
        return;
      }
      await pending;
    });
  });

  it('routes every input to exactly one outcome: processed, ignored, or dead-lettered', async () => {
    await check('single-outcome', async (shape, invoice) => {
      const event = materialize(shape);
      const decoded = decodeEvent(event);
      if (invoice.kind === 'throw' && decoded.kind === 'ok') return;
      await processEvent(event as never);
      const state = snapshot();
      if (decoded.kind === 'malformed') {
        expect(state).toMatchObject({ events: [], invoices: [], deadLetters: 1 });
        expect(listDeadLetters(1)[0]).toMatchObject({ reason: decoded.reason });
        return;
      }
      if (decoded.kind === 'ignored') {
        expect(state).toEqual({ events: [], invoices: [], deadLetters: 0 });
        return;
      }
      if (invoice.kind === 'malformed') {
        expect(state).toMatchObject({ events: [], invoices: [], deadLetters: 1 });
        expect(listDeadLetters(1)[0]).toMatchObject({
          reason: 'invalid_invoice_state',
          event_id: decoded.event.event_id,
        });
        return;
      }
      expect(state.deadLetters).toBe(0);
      expect(state.events).toHaveLength(1);
      expect(state.invoices).toHaveLength(invoice.kind === 'valid' ? 1 : 0);
    });
  });

  it('never writes an event row without the decoded id, a finite invoice id and the original ledger', async () => {
    await check('integrity', async (shape, invoice) => {
      const event = materialize(shape);
      const decoded = decodeEvent(event);
      if (decoded.kind !== 'ok' || invoice.kind === 'throw') return;
      await processEvent(event as never);
      const rows = getDb().prepare('SELECT * FROM events').all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        expect(row.event_id).toBe(decoded.event.event_id);
        expect(row.invoice_id).toBe(decoded.event.invoice_id);
        expect(Number.isSafeInteger(row.invoice_id)).toBe(true);
        expect(row.ledger).toBe(decoded.event.ledger);
        expect(row.event_type).toBe(decoded.event.event_type);
      }
      const stored = getInvoiceById(decoded.event.invoice_id);
      if (invoice.kind === 'valid') {
        expect(stored).toMatchObject({ id: decoded.event.invoice_id, status: invoice.status });
        expect(isValidInvoiceState(stored)).toBe(true);
      } else {
        expect(stored).toBeUndefined();
      }
    });
  });

  it('is idempotent: replaying any event leaves the database unchanged', async () => {
    await check('idempotent', async (shape, invoice) => {
      const event = materialize(shape);
      const decoded = decodeEvent(event);
      if (invoice.kind === 'throw' && decoded.kind === 'ok') return;
      await processEvent(event as never);
      const first = snapshot();
      const deadLettered =
        decoded.kind === 'malformed' || (decoded.kind === 'ok' && invoice.kind === 'malformed');
      if (deadLettered) {
        // Dead-lettering is append-only by design; the second attempt records a second row.
        await processEvent(event as never);
        expect(snapshot()).toMatchObject({
          events: first.events,
          invoices: first.invoices,
          deadLetters: 2,
        });
        return;
      }
      await processEvent(event as never);
      expect(snapshot()).toEqual(first);
    });
  });

  it('is order-independent: the last fetched state wins for any interleaving of valid events', async () => {
    const validEvents = fc.array(
      fc.record({
        id: fc.stringMatching(/^[0-9]{6}-[0-9]-[0-9]$/),
        type: fc.constantFrom('submitted', 'funded', 'paid', 'defaulted'),
        status: fc.constantFrom('Pending', 'Funded', 'Paid', 'Defaulted'),
      }),
      { minLength: 1, maxLength: 6 }
    );
    await fc.assert(
      fc.asyncProperty(validEvents, async (events) => {
        setDb(createDb(':memory:'));
        vi.mocked(fetchInvoice).mockReset();
        const { nativeToScVal, xdr } = await import('@stellar/stellar-sdk');
        let last: string | null = null;
        for (const [index, spec] of events.entries()) {
          vi.mocked(fetchInvoice).mockResolvedValueOnce(validInvoice(1, spec.status) as never);
          await processEvent({
            id: `${spec.id}-${index}`,
            ledger: 1000 + index,
            ledgerClosedAt: '2024-01-01T00:00:00Z',
            topic: [xdr.ScVal.scvSymbol(spec.type)],
            value: nativeToScVal(1n, { type: 'u64' }),
          } as never);
          last = spec.status;
        }
        expect(getInvoiceById(1)?.status).toBe(last);
        expect(getDb().prepare('SELECT COUNT(*) AS c FROM events').get()).toEqual({
          c: events.length,
        });
      }),
      { numRuns: Math.max(50, Math.floor(NUM_RUNS / 3)), seed: SEED }
    );
  });
});

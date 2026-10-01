import { describe, expect, it, vi } from 'vitest';
import { createDb, getDb, setDb } from '../src/db';
import { countDeadLetters, listDeadLetters } from '../src/deadLetter';
import { processEvent } from '../src/processor';
import { materialize, validInvoice } from './fuzz/arbitraries';
import { deserializeShape, loadCorpus } from './fuzz/corpus';

vi.mock('../src/rpc', () => ({ fetchInvoice: vi.fn(), server: {} }));
vi.mock('../src/cache', () => ({ invalidateInvoiceCache: vi.fn().mockResolvedValue(undefined) }));
import { fetchInvoice } from '../src/rpc';

/**
 * Replays every persisted fuzz counterexample (tests/fuzz-corpus/*.json) as an
 * example-based regression test. A case with `finding` starting in
 * "UNREVIEWED" was written by the fuzzer and has not been triaged yet; it
 * fails here on purpose until someone records the expected outcome.
 */
const corpus = loadCorpus();

describe('indexer fuzz corpus replay', () => {
  it('has a corpus to replay', () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  for (const testCase of corpus) {
    it(`${testCase.name}: ${testCase.finding.slice(0, 80)}`, async () => {
      expect(testCase.finding.startsWith('UNREVIEWED')).toBe(false);
      setDb(createDb(':memory:'));
      vi.mocked(fetchInvoice).mockReset();
      const shape = deserializeShape(testCase.event);
      switch (testCase.invoice.kind) {
        case 'null':
          vi.mocked(fetchInvoice).mockResolvedValue(null);
          break;
        case 'valid':
          vi.mocked(fetchInvoice).mockImplementation(
            async (id: number) =>
              validInvoice(
                id,
                testCase.invoice.kind === 'valid' ? testCase.invoice.status : 'Pending'
              ) as never
          );
          break;
        case 'malformed':
          vi.mocked(fetchInvoice).mockResolvedValue(testCase.invoice.value as never);
          break;
        case 'throw':
          vi.mocked(fetchInvoice).mockRejectedValue(new Error('rpc unavailable'));
          break;
      }
      const event = materialize(shape);
      const eventCount = () =>
        (getDb().prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c;
      switch (testCase.expect.outcome) {
        case 'throws':
          await expect(processEvent(event as never)).rejects.toThrow();
          expect(eventCount()).toBe(0);
          expect(countDeadLetters()).toBe(0);
          break;
        case 'malformed':
          await processEvent(event as never);
          expect(eventCount()).toBe(0);
          expect(countDeadLetters()).toBe(1);
          expect(listDeadLetters(1)[0].reason).toBe(testCase.expect.reason);
          break;
        case 'ignored':
          await processEvent(event as never);
          expect(eventCount()).toBe(0);
          expect(countDeadLetters()).toBe(0);
          break;
        case 'processed':
          await processEvent(event as never);
          expect(eventCount()).toBe(1);
          expect(countDeadLetters()).toBe(0);
          break;
      }
    });
  }
});

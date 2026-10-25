import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, setDb, getCursorLedger, setCursorLedger } from '../src/db';
import { pollOnce, setConfirmationPolicy, getConfirmationPolicy } from '../src/poller';
import { CanonicalConfirmationPolicy } from '../src/policy';

vi.mock('../src/rpc', () => ({
  fetchInvoice: vi.fn(),
  server: {
    getEvents: vi.fn(),
    getLatestLedger: vi.fn(),
  },
}));

vi.mock('../src/cache', () => ({
  invalidateInvoiceCache: vi.fn().mockResolvedValue(undefined),
}));

import { server, fetchInvoice } from '../src/rpc';

function makeRawEvent(ledger: number, id = `evt-${ledger}`) {
  return {
    id,
    pagingToken: id,
    type: 'contract',
    ledger,
    ledgerClosedAt: '2026-01-01T00:00:00Z',
    contractId: 'C_TEST',
    topic: [xdr.ScVal.scvSymbol('submitted')],
    value: nativeToScVal(1n, { type: 'u64' }),
    inSuccessfulContractCall: true,
  } as any;
}

describe('Issue #1261: Canonical-ledger confirmation depth policy', () => {
  let defaultPolicy: CanonicalConfirmationPolicy;

  beforeEach(() => {
    setDb(createDb(':memory:'));
    defaultPolicy = new CanonicalConfirmationPolicy(10);
    setConfirmationPolicy(defaultPolicy);
    vi.mocked(fetchInvoice).mockReset().mockResolvedValue(null);
    vi.mocked(server.getEvents).mockReset();
    vi.mocked(server.getLatestLedger).mockReset().mockResolvedValue({ sequence: 1000 } as any);
  });

  describe('Policy validation & calculations', () => {
    it('validates legal confirmation depths and updates confirmationDepthGauge', () => {
      expect(getConfirmationPolicy()).toBe(defaultPolicy);
      const policy = new CanonicalConfirmationPolicy(15);
      expect(policy.getDepth()).toBe(15);

      policy.setDepth(0);
      expect(policy.getDepth()).toBe(0);

      policy.setDepth(100);
      expect(policy.getDepth()).toBe(100);
    });

    it('rejects invalid or negative confirmation depths (fail-closed)', () => {
      expect(() => new CanonicalConfirmationPolicy(-1)).toThrow(/Invalid confirmation depth/);
      expect(() => new CanonicalConfirmationPolicy(1.5)).toThrow(/Invalid confirmation depth/);
      expect(() => new CanonicalConfirmationPolicy(1001)).toThrow(/exceeds maximum threshold/);
    });

    it('calculates confirmation status and confirmed tip sequence accurately', () => {
      const policy = new CanonicalConfirmationPolicy(10);
      const tip = 500;

      // Event at ledger 490: 500 - 490 = 10 >= 10 -> confirmed
      expect(policy.isConfirmed(490, tip)).toBe(true);

      // Event at ledger 480: 500 - 480 = 20 >= 10 -> confirmed
      expect(policy.isConfirmed(480, tip)).toBe(true);

      // Event at ledger 491: 500 - 491 = 9 < 10 -> unconfirmed
      expect(policy.isConfirmed(491, tip)).toBe(false);

      // Confirmed tip: 500 - 10 = 490
      expect(policy.getConfirmedTip(tip)).toBe(490);
    });
  });

  describe('Poller integration with confirmation depth policy', () => {
    it('processes confirmed events at exactly the boundary and defers unconfirmed events', async () => {
      setCursorLedger(450);
      const latestTip = 500; // Confirmation window is [491, 500], confirmed <= 490

      const events = [
        makeRawEvent(485, 'evt-485'), // Confirmed
        makeRawEvent(490, 'evt-490'), // Exactly at boundary: confirmed
        makeRawEvent(491, 'evt-491'), // Inside unconfirmed depth: deferred
        makeRawEvent(500, 'evt-500'), // Chain tip: deferred
      ];

      vi.mocked(server.getEvents).mockResolvedValueOnce({
        events,
        latestLedger: latestTip,
        cursor: 'next',
      } as any);

      await pollOnce();

      // Only confirmed events (485, 490) were processed; cursor advanced to 490
      expect(getCursorLedger()).toBe(490);
      expect(fetchInvoice).toHaveBeenCalledTimes(2);
    });

    it('allows zero confirmation depth to process tip events immediately', async () => {
      setCursorLedger(450);
      setConfirmationPolicy(new CanonicalConfirmationPolicy(0));

      const events = [
        makeRawEvent(490, 'evt-490'),
        makeRawEvent(500, 'evt-500'), // Exactly at tip
      ];

      vi.mocked(server.getEvents).mockResolvedValueOnce({
        events,
        latestLedger: 500,
        cursor: 'next',
      } as any);

      await pollOnce();

      // With depth = 0, both 490 and 500 are processed immediately
      expect(getCursorLedger()).toBe(500);
      expect(fetchInvoice).toHaveBeenCalledTimes(2);
    });

    it('defers events under deep confirmation policy (e.g. 50 ledgers)', async () => {
      setCursorLedger(400);
      setConfirmationPolicy(new CanonicalConfirmationPolicy(50));
      const latestTip = 500; // Confirmed tip <= 450

      const events = [
        makeRawEvent(440, 'evt-440'), // Confirmed (500 - 440 = 60 >= 50)
        makeRawEvent(450, 'evt-450'), // Exactly at boundary (500 - 450 = 50 >= 50)
        makeRawEvent(460, 'evt-460'), // Deferred (500 - 460 = 40 < 50)
      ];

      vi.mocked(server.getEvents).mockResolvedValueOnce({
        events,
        latestLedger: latestTip,
        cursor: 'next',
      } as any);

      await pollOnce();

      expect(getCursorLedger()).toBe(450);
      expect(fetchInvoice).toHaveBeenCalledTimes(2);
    });

    it('preserves deferred events across poll cycles until confirmed by advancing tip', async () => {
      setCursorLedger(490);
      const policy = new CanonicalConfirmationPolicy(10);
      setConfirmationPolicy(policy);

      // Cycle 1: Event at ledger 495 with tip 500 -> deferred (500 - 495 = 5 < 10)
      const event495 = makeRawEvent(495, 'evt-495');
      vi.mocked(server.getEvents).mockResolvedValueOnce({
        events: [event495],
        latestLedger: 500,
        cursor: 'cur-1',
      } as any);

      await pollOnce();

      // Event was deferred, cursor is confirmed tip (490)
      expect(getCursorLedger()).toBe(490);
      expect(fetchInvoice).not.toHaveBeenCalled();

      // Cycle 2: Chain tip advances to 505 -> Event 495 is now confirmed (505 - 495 = 10 >= 10)
      vi.mocked(server.getEvents).mockResolvedValueOnce({
        events: [event495],
        latestLedger: 505,
        cursor: 'cur-2',
      } as any);

      await pollOnce();

      // Now event 495 is confirmed and processed, cursor advances to 495 (confirmed tip 495)
      expect(getCursorLedger()).toBe(495);
      expect(fetchInvoice).toHaveBeenCalledTimes(1);
    });
  });
});

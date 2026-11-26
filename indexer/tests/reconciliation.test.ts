import { describe, expect, it, vi } from 'vitest';
import { createDb, setDb, setCursorLedger } from '../src/db';
import { runReconciliation } from '../src/reconciliation';

vi.mock('../src/rpc', () => ({
  fetchInvoice: vi.fn(),
  server: {
    getLatestLedger: vi.fn(),
  },
}));

import { server } from '../src/rpc';

beforeEach(() => {
  setDb(createDb(':memory:'));
  setCursorLedger(0);
  vi.mocked(server.getLatestLedger).mockReset();
});

describe('reconciliation — failure semantics (#1439)', () => {
  it('returns healthy when the cursor matches the chain tip', async () => {
    setCursorLedger(100);
    vi.mocked(server.getLatestLedger).mockResolvedValueOnce(100);

    const result = await runReconciliation();
    expect(result.healthy).toBe(true);
    expect(result.cursorLedger).toBe(100);
    expect(result.chainTipLedger).toBe(100);
    expect(result.driftLedgers).toBe(0);
  });

  it('returns healthy when the cursor is within the confirmation depth of the tip', async () => {
    setCursorLedger(95);
    vi.mocked(server.getLatestLedger).mockResolvedValueOnce(100);

    const result = await runReconciliation();
    // 100 - 95 = 5 ledgers of drift, which is within the default depth of 10.
    expect(result.healthy).toBe(true);
    expect(result.driftLedgers).toBe(5);
  });

  it('returns unhealthy when the cursor lags the chain tip beyond the confirmation depth', async () => {
    setCursorLedger(50);
    vi.mocked(server.getLatestLedger).mockResolvedValueOnce(100);

    const result = await runReconciliation();
    // 100 - 50 = 50 ledgers of drift, which exceeds the default depth of 10.
    expect(result.healthy).toBe(false);
    expect(result.driftLedgers).toBe(50);
    expect(result.recommendation).toContain('behind');
  });

  it('returns unhealthy when the RPC node is unreachable', async () => {
    setCursorLedger(100);
    vi.mocked(server.getLatestLedger).mockRejectedValueOnce(new Error('RPC connection refused'));

    const result = await runReconciliation();
    expect(result.healthy).toBe(false);
    expect(result.chainTipLedger).toBeNull();
    expect(result.recommendation).toContain('unreachable');
  });

  it('returns unhealthy when the chain tip is behind the persisted cursor (reorg)', async () => {
    setCursorLedger(200);
    vi.mocked(server.getLatestLedger).mockResolvedValueOnce(150);

    const result = await runReconciliation();
    // A tip below the cursor is a chain reorg — must be reported as unhealthy.
    expect(result.healthy).toBe(false);
    expect(result.chainTipLedger).toBe(150);
    expect(result.driftLedgers).toBeLessThan(0);
    expect(result.recommendation).toContain('reorg');
  });

  it('is idempotent: repeated healthy checks report the same state', async () => {
    setCursorLedger(300);
    vi.mocked(server.getLatestLedger).mockResolvedValue(300);

    const first = await runReconciliation();
    const second = await runReconciliation();
    expect(first).toEqual(second);
    expect(first.healthy).toBe(true);
  });

  it('does not crash the scheduler when a reconciliation job fails', async () => {
    setCursorLedger(100);
    vi.mocked(server.getLatestLedger).mockRejectedValueOnce(new Error('boom'));

    // The scheduler swallows errors; the promise must resolve, not reject.
    await expect(runReconciliation()).resolves.toMatchObject({ healthy: false });
  });
});
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, getDb, setCursorLedger, setDb } from '../src/db';
import { DeadLetterQueue } from '../src/dlq';
import {
  cursorAgeSeconds,
  dlqEnqueuedTotal,
  dlqEntries,
  dlqExhaustedTotal,
  lastSuccessfulPollTimestamp,
  ledgerLag,
  networkLatestLedger,
  pollCyclesTotal,
  registerDeadLetterQueue,
  registry,
  reorgRollbackDepth,
} from '../src/metrics';
import { getConfirmationPolicy, pollOnce } from '../src/poller';

// Health & lag metrics (#1453). See docs/indexer/observability-audit.md.

vi.mock('../src/rpc', () => ({
  fetchInvoice: vi.fn(),
  server: { getEvents: vi.fn(), getLatestLedger: vi.fn() },
}));

import { fetchInvoice, server } from '../src/rpc';

type Labels = Record<string, string | number>;

async function value(metric: { get(): Promise<{ values: { value: number; labels: Labels }[] }> }, labels: Labels = {}) {
  const { values } = await metric.get();
  const match = values.find((v) =>
    Object.entries(labels).every(([k, want]) => String(v.labels[k]) === String(want))
  );
  return match?.value;
}

async function histogramCount(): Promise<number> {
  const { values } = await reorgRollbackDepth.get();
  return values.find((v) => (v as { metricName?: string }).metricName?.endsWith('_count'))?.value ?? 0;
}

beforeEach(() => {
  setDb(createDb(':memory:'));
  vi.mocked(fetchInvoice).mockReset().mockResolvedValue(null);
  vi.mocked(server.getEvents).mockReset();
});

describe('iln_cursor_age_seconds (source of truth: persisted cursor row)', () => {
  it('is absent (not 0) before the first sync', async () => {
    expect(await value(cursorAgeSeconds)).toBeUndefined();
  });

  it('reports the age of the persisted cursor write', async () => {
    setCursorLedger(100);
    expect(await value(cursorAgeSeconds)).toBeLessThan(2);
    getDb().prepare('UPDATE cursor SET updated_at = ? WHERE id = 1').run(Date.now() - 120_000);
    const age = await value(cursorAgeSeconds);
    expect(age).toBeGreaterThanOrEqual(120);
    expect(age).toBeLessThan(125);
  });

  it('is absent when the database cannot be read, so absent() alerts fire', async () => {
    setCursorLedger(100);
    const db = createDb(':memory:');
    db.close();
    setDb(db);
    expect(await value(cursorAgeSeconds)).toBeUndefined();
    // The scrape itself must still succeed.
    await expect(registry.metrics()).resolves.toContain('iln_cursor_age_seconds');
  });

  it('clamps a future timestamp (clock skew) to 0', async () => {
    setCursorLedger(100);
    getDb().prepare('UPDATE cursor SET updated_at = ? WHERE id = 1').run(Date.now() + 600_000);
    expect(await value(cursorAgeSeconds)).toBe(0);
  });
});

describe('poll cycle health and ledger lag', () => {
  it('success: exports network tip, lag behind tip and last success time', async () => {
    setCursorLedger(100);
    const before = (await value(pollCyclesTotal, { outcome: 'success' })) ?? 0;
    vi.mocked(server.getEvents).mockResolvedValue({ events: [], latestLedger: 150, cursor: 'c' } as never);

    await pollOnce();

    const depth = getConfirmationPolicy().getDepth();
    expect(await value(networkLatestLedger)).toBe(150);
    expect(await value(ledgerLag)).toBe(depth); // cursor advances to the confirmed tip
    expect(await value(pollCyclesTotal, { outcome: 'success' })).toBe(before + 1);
    expect(Date.now() / 1000 - ((await value(lastSuccessfulPollTimestamp)) ?? 0)).toBeLessThan(5);
  });

  it('failure: counts the failed cycle and leaves the last-success time and lag untouched', async () => {
    setCursorLedger(100);
    vi.mocked(server.getEvents).mockResolvedValueOnce({ events: [], latestLedger: 150, cursor: 'c' } as never);
    await pollOnce();
    const lastSuccess = await value(lastSuccessfulPollTimestamp);
    const lag = await value(ledgerLag);
    const failuresBefore = (await value(pollCyclesTotal, { outcome: 'failure' })) ?? 0;

    vi.mocked(server.getEvents).mockRejectedValueOnce(new Error('socket hang up'));
    await expect(pollOnce()).rejects.toThrow('socket hang up');

    expect(await value(pollCyclesTotal, { outcome: 'failure' })).toBe(failuresBefore + 1);
    expect(await value(lastSuccessfulPollTimestamp)).toBe(lastSuccess);
    expect(await value(ledgerLag)).toBe(lag);
  });

  it('reorg: records how many ledgers were rolled back', async () => {
    setCursorLedger(500);
    const before = await histogramCount();
    vi.mocked(server.getEvents)
      .mockResolvedValueOnce({ events: [], latestLedger: 480, cursor: 'c' } as never)
      .mockResolvedValueOnce({ events: [], latestLedger: 480, cursor: 'c' } as never);

    await pollOnce();

    expect(await histogramCount()).toBe(before + 1);
    expect(await value(networkLatestLedger)).toBe(480);
  });
});

describe('iln_dlq_entries and DLQ counters', () => {
  it('is absent while no dead-letter queue is registered', async () => {
    expect(await value(dlqEntries, { state: 'pending' })).toBeUndefined();
  });

  it('tracks pending -> exhausted transitions and stops reporting after unregister', async () => {
    let now = 0;
    const queue = new DeadLetterQueue<{ id: string }>({ maxAttempts: 2, baseDelayMs: 10, now: () => now });
    const unregister = registerDeadLetterQueue(queue);
    const enqueuedBefore = (await value(dlqEnqueuedTotal)) ?? 0;
    const exhaustedBefore = (await value(dlqExhaustedTotal)) ?? 0;

    queue.enqueue({ id: 'evt-1' }, { error: new Error('rpc down') });
    expect(await value(dlqEntries, { state: 'pending' })).toBe(1);
    expect(await value(dlqEntries, { state: 'exhausted' })).toBe(0);

    now = 1_000;
    await queue.retryDue(() => {
      throw new Error('still down');
    });
    expect(await value(dlqEntries, { state: 'pending' })).toBe(0);
    expect(await value(dlqEntries, { state: 'exhausted' })).toBe(1);
    expect(await value(dlqEnqueuedTotal)).toBe(enqueuedBefore + 2);
    expect(await value(dlqExhaustedTotal)).toBe(exhaustedBefore + 1);

    // Repeated failure of an already-exhausted entry is not double counted.
    queue.enqueue({ id: 'evt-1' }, { error: new Error('again') });
    expect(await value(dlqExhaustedTotal)).toBe(exhaustedBefore + 1);

    unregister();
    expect(await value(dlqEntries, { state: 'pending' })).toBeUndefined();
  });
});

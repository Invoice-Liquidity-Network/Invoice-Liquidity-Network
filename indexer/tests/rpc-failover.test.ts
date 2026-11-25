import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, getDb, setDb } from '../src/db';
import { rpcFailoversTotal, rpcRequestsTotal } from '../src/metrics';
import { processEvent } from '../src/processor';
import {
  createFailoverClient,
  fetchInvoice,
  isRpcApplicationError,
  RpcTimeoutError,
  RpcUnavailableError,
  server,
  withTimeout,
  type RpcReadClient,
} from '../src/rpc';

// RPC failover, timeout and unknown-outcome handling (#1454).
// See docs/indexer/observability-audit.md.

const TIMEOUT_MS = 30;
const SECRET_URL = 'https://user:apikey-123@rpc.example.com';

function ledger(sequence: number) {
  return { id: 'x', sequence, protocolVersion: 22 } as never;
}

function fakeClient(impl: Partial<Record<keyof RpcReadClient, () => Promise<unknown>>> = {}) {
  return {
    getEvents: vi.fn(impl.getEvents ?? (() => Promise.resolve({ events: [], latestLedger: 1 }))),
    getLatestLedger: vi.fn(impl.getLatestLedger ?? (() => Promise.resolve(ledger(1)))),
    simulateTransaction: vi.fn(impl.simulateTransaction ?? (() => Promise.resolve({}))),
  } as unknown as RpcReadClient & Record<keyof RpcReadClient, ReturnType<typeof vi.fn>>;
}

const never = () => new Promise<never>(() => {});

async function counter(labels: Record<string, string>) {
  const { values } = await rpcRequestsTotal.get();
  return (
    values.find((v) => Object.entries(labels).every(([k, want]) => v.labels[k as never] === want))
      ?.value ?? 0
  );
}

describe('withTimeout', () => {
  it('resolves when the call settles in time and rejects with the timeout error otherwise', async () => {
    await expect(withTimeout(() => Promise.resolve(7), TIMEOUT_MS, () => new Error('t'))).resolves.toBe(7);
    await expect(withTimeout(never, TIMEOUT_MS, () => new Error('timed out'))).rejects.toThrow('timed out');
  });

  it('propagates synchronous throws from the call', async () => {
    await expect(
      withTimeout(() => {
        throw new Error('sync boom');
      }, TIMEOUT_MS, () => new Error('t'))
    ).rejects.toThrow('sync boom');
  });
});

describe('isRpcApplicationError', () => {
  it('separates JSON-RPC error objects from transport errors', () => {
    expect(isRpcApplicationError({ code: -32600, message: 'startLedger must be positive' })).toBe(true);
    expect(isRpcApplicationError(new Error('ECONNRESET'))).toBe(false);
    expect(isRpcApplicationError(new RpcTimeoutError('getEvents', 'primary', 1))).toBe(false);
    expect(isRpcApplicationError('oops')).toBe(false);
  });
});

describe('createFailoverClient', () => {
  it('normal: answers from the primary without touching fallbacks', async () => {
    const primary = fakeClient({ getLatestLedger: () => Promise.resolve(ledger(10)) });
    const fallback = fakeClient();
    const client = createFailoverClient(
      [
        { role: 'primary', client: primary },
        { role: 'fallback_1', client: fallback },
      ],
      { timeoutMs: TIMEOUT_MS }
    );
    await expect(client.getLatestLedger()).resolves.toMatchObject({ sequence: 10 });
    expect(fallback.getLatestLedger).not.toHaveBeenCalled();
    expect(client.activeEndpoint()).toBe('primary');
  });

  it('polling: a timed-out getEvents fails over and later reads stay on the healthy endpoint', async () => {
    const primary = fakeClient({ getEvents: never });
    const fallback = fakeClient({ getEvents: () => Promise.resolve({ events: [], latestLedger: 99 }) });
    const client = createFailoverClient(
      [
        { role: 'primary', client: primary },
        { role: 'fallback_1', client: fallback },
      ],
      { timeoutMs: TIMEOUT_MS }
    );
    const timeoutsBefore = await counter({ endpoint: 'primary', operation: 'getEvents', outcome: 'timeout' });
    const { values: before } = await rpcFailoversTotal.get();
    const failoversBefore = before.find((v) => v.labels.operation === 'getEvents')?.value ?? 0;

    await expect(client.getEvents({ startLedger: 1, filters: [] })).resolves.toMatchObject({ latestLedger: 99 });
    expect(client.activeEndpoint()).toBe('fallback_1');
    expect(await counter({ endpoint: 'primary', operation: 'getEvents', outcome: 'timeout' })).toBe(timeoutsBefore + 1);
    const { values: after } = await rpcFailoversTotal.get();
    expect(after.find((v) => v.labels.operation === 'getEvents')?.value).toBe(failoversBefore + 1);

    // Sticky: the next poll does not pay the primary's timeout again.
    await client.getEvents({ startLedger: 1, filters: [] });
    expect(primary.getEvents).toHaveBeenCalledTimes(1);
    expect(fallback.getEvents).toHaveBeenCalledTimes(2);
  });

  it('ledger reads: a transport error fails over', async () => {
    const primary = fakeClient({ getLatestLedger: () => Promise.reject(new Error('connect ECONNREFUSED')) });
    const fallback = fakeClient({ getLatestLedger: () => Promise.resolve(ledger(42)) });
    const client = createFailoverClient(
      [
        { role: 'primary', client: primary },
        { role: 'fallback_1', client: fallback },
      ],
      { timeoutMs: TIMEOUT_MS }
    );
    await expect(client.getLatestLedger()).resolves.toMatchObject({ sequence: 42 });
  });

  it('a JSON-RPC error is the node\'s answer: rethrown as-is, no failover', async () => {
    const rpcError = { code: -32600, message: 'startLedger must be within retention' };
    const primary = fakeClient({ getEvents: () => Promise.reject(rpcError) });
    const fallback = fakeClient();
    const client = createFailoverClient(
      [
        { role: 'primary', client: primary },
        { role: 'fallback_1', client: fallback },
      ],
      { timeoutMs: TIMEOUT_MS }
    );
    await expect(client.getEvents({ startLedger: 1, filters: [] })).rejects.toBe(rpcError);
    expect(fallback.getEvents).not.toHaveBeenCalled();
  });

  it('unknown outcome everywhere: throws RpcUnavailableError naming roles, never URLs', async () => {
    const client = createFailoverClient(
      [
        { role: 'primary', client: fakeClient({ simulateTransaction: never }) },
        {
          role: 'fallback_1',
          client: fakeClient({ simulateTransaction: () => Promise.reject(new Error(`fetch failed ${SECRET_URL}`)) }),
        },
      ],
      { timeoutMs: TIMEOUT_MS }
    );
    const err = await client.simulateTransaction({} as never).catch((e) => e);
    expect(err).toBeInstanceOf(RpcUnavailableError);
    expect(err.failures.map((f: { endpoint: string; outcome: string }) => [f.endpoint, f.outcome])).toEqual([
      ['primary', 'timeout'],
      ['fallback_1', 'transport_error'],
    ]);
    expect(err.message).not.toContain('apikey-123');
    // Labels are roles only.
    const metrics = JSON.stringify((await rpcRequestsTotal.get()).values);
    expect(metrics).not.toContain('rpc.example.com');
  });

  it('a late answer from a timed-out endpoint is discarded', async () => {
    let lateResolve: (v: unknown) => void = () => {};
    const primary = fakeClient({ getLatestLedger: () => new Promise((r) => (lateResolve = r)) });
    const fallback = fakeClient({ getLatestLedger: () => Promise.resolve(ledger(2)) });
    const client = createFailoverClient(
      [
        { role: 'primary', client: primary },
        { role: 'fallback_1', client: fallback },
      ],
      { timeoutMs: TIMEOUT_MS }
    );
    const result = await client.getLatestLedger();
    lateResolve(ledger(1));
    expect(result).toMatchObject({ sequence: 2 });
  });

  it('rejects an empty endpoint list', () => {
    expect(() => createFailoverClient([], { timeoutMs: 1 })).toThrow('at least one');
  });
});

describe('fetchInvoice outcome classification', () => {
  it('returns null only when the contract answered without an invoice', async () => {
    const client = fakeClient({
      simulateTransaction: () => Promise.resolve({ error: 'HostError: invoice not found', events: [], latestLedger: 1 }),
    });
    await expect(fetchInvoice(1, client)).resolves.toBeNull();
  });

  it('rejects (does not return null) when the RPC outcome is unknown', async () => {
    const client = fakeClient({
      simulateTransaction: () =>
        Promise.reject(new RpcUnavailableError('simulateTransaction', [
          { endpoint: 'primary', outcome: 'timeout', message: 'timed out' },
        ])),
    });
    await expect(fetchInvoice(1, client)).rejects.toBeInstanceOf(RpcUnavailableError);
  });
});

describe('processor across the RPC boundary', () => {
  beforeEach(() => setDb(createDb(':memory:')));
  afterEach(() => vi.restoreAllMocks());

  function submittedEvent(id: string) {
    return {
      id,
      pagingToken: id,
      type: 'contract',
      ledger: 100,
      ledgerClosedAt: '2024-01-01T00:00:00Z',
      contractId: 'CTEST',
      topic: [xdr.ScVal.scvSymbol('submitted')],
      value: nativeToScVal(1n, { type: 'u64' }),
      inSuccessfulContractCall: true,
    } as never;
  }

  const eventCount = () =>
    (getDb().prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c;

  it('an unknown RPC outcome leaves the event uncommitted so the next poll replays it', async () => {
    const simulate = vi
      .spyOn(server, 'simulateTransaction')
      .mockRejectedValue(
        new RpcUnavailableError('simulateTransaction', [
          { endpoint: 'primary', outcome: 'timeout', message: 'timed out' },
        ])
      );

    await expect(processEvent(submittedEvent('evt-unknown'))).rejects.toBeInstanceOf(RpcUnavailableError);
    expect(simulate).toHaveBeenCalledTimes(3); // the processor's retry loop now runs
    expect(eventCount()).toBe(0); // before #1454 the event was committed without invoice state

    // Replay once the node answers: the event is applied exactly once.
    simulate.mockResolvedValue({ error: 'not found', events: [], latestLedger: 1 } as never);
    await processEvent(submittedEvent('evt-unknown'));
    await processEvent(submittedEvent('evt-unknown'));
    expect(eventCount()).toBe(1);
  }, 10_000);
});

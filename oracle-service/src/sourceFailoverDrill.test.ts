import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Source-failover drill (issue #1051).
 *
 * This is the game-day script from docs/oracle-source-failover-runbook.md,
 * run as a test: a simulated primary outage must be absorbed by the service
 * with no human in the loop, failback must wait for the success streak and
 * the cooldown, and a flapping primary must not thrash the routing.
 */

const simulate = vi.fn();
const scValToNative = vi.fn();
const getAccountCalls: string[] = [];
let rpcFailMode: 'none' | 'primary' | 'all' = 'none';

vi.mock('@stellar/stellar-sdk', async () => {
  class FakeAddress {
    constructor(public readonly value: string) {
      if (!value.startsWith('G')) throw new Error('invalid address');
    }
    static fromString(value: string) {
      return new FakeAddress(value);
    }
    toScVal() {
      return { address: this.value };
    }
  }

  return {
    Address: FakeAddress,
    BASE_FEE: '100',
    Contract: class {
      constructor(public readonly id: string) {}
      call(method: string, arg: unknown) {
        return { method, arg };
      }
    },
    Keypair: { random: () => ({ publicKey: () => 'GRANDOMSOURCE' }) },
    Networks: { TESTNET: 'Test SDF Network ; September 2015' },
    TransactionBuilder: class {
      account: unknown;
      opts: unknown;
      constructor(account: unknown, opts: unknown) {
        this.account = account;
        this.opts = opts;
      }
      addOperation() {
        return this;
      }
      setTimeout() {
        return this;
      }
      build() {
        return { tx: true };
      }
    },
    nativeToScVal: vi.fn(),
    rpc: {
      Server: class {
        url: string;
        constructor(url: string) {
          this.url = url;
        }
        async getAccount(source: string) {
          getAccountCalls.push(`${this.url}|${source}`);
          if (
            rpcFailMode === 'all' ||
            (rpcFailMode === 'primary' && this.url.includes('primary'))
          ) {
            throw new Error('soroban rpc unavailable');
          }
          return { accountId: () => 'GSOURCE', sequenceNumber: () => '1' };
        }
        async simulateTransaction() {
          return simulate();
        }
      },
    },
    scValToNative: (...args: unknown[]) => scValToNative(...args),
    xdr: {},
  };
});

const { SourceHealthTracker, withFailover } = await import('./sourceFailover');
const { defaultDeltaBoundsConfig } = await import('./deltaBounds');
const { createOracleApp } = await import('./index');
const { TEST_PAYER, healthyHistory, makeReputation } = await import('./testFixtures');

const FAST = {
  windowSize: 50,
  errorRateThreshold: 0.5,
  errorRateUnavailableThreshold: 1,
  latencyP95ThresholdMs: 1500,
  staleAfterMs: 5 * 60 * 1000,
  recoverySuccesses: 2,
  cooldownMs: 1000,
};

const VALID_BODY = { payer: TEST_PAYER, amount: '10000000', invoiceId: 42 };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  rpcFailMode = 'none';
  getAccountCalls.length = 0;
});

describe('drill: simulated primary outage end to end', () => {
  it('flapping primaries do not cause rapid source churn', async () => {
    let nowMs = 0;
    let primaryAttempts = 0;
    const tracker = new SourceHealthTracker({ config: FAST });
    const run = withFailover(
      {
        primary: {
          id: 'flapper',
          invoke: async () => {
            primaryAttempts += 1;
            // Alternate up/down on every attempt — the worst-case oscillation.
            if (primaryAttempts % 2 === 1) throw new Error('flap');
            return 'from-primary';
          },
        },
        secondary: {
          id: 'steady',
          invoke: async () => 'from-secondary',
        },
      },
      tracker,
      { now: () => nowMs }
    );

    const served: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      nowMs = i * 100;
      served.push(await run());
    }

    // Every request is served even with the primary bouncing.
    expect(served).toHaveLength(20);
    // One probe per cooldown window at most — the primary is never hammered
    // call-after-call while it oscillates.
    expect(primaryAttempts).toBeLessThanOrEqual(4);
    // Role switches stay rare: at most one per cooldown window.
    const switches = served.slice(1).filter((s, i) => s !== served[i]).length;
    expect(switches).toBeLessThanOrEqual(3);
  });
});

describe('drill: app wiring with fallback sources', () => {
  it('moves history traffic to the fallback indexer automatically and alerts via metrics', async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('primary')) {
        return new Response('boom', { status: 500 });
      }
      return new Response(JSON.stringify(healthyHistory(Date.now())), { status: 200 });
    }) as unknown as typeof fetch;

    const { app, close, health } = await createOracleApp({
      indexerBaseUrl: 'http://primary.local',
      indexerFallbackUrl: 'http://fallback.local',
      historyProvider: undefined,
      reputationProvider: async () => makeReputation(Date.now(), { score: 90 }),
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);

      // The outage was invisible to the caller: history still came through,
      // from the fallback.
      expect(res.status).toBe(200);
      expect(Number(res.body.averageHistoricalAmount)).toBeGreaterThan(0);
      expect(urls.some((u) => u.includes('primary'))).toBe(true);
      expect(urls.some((u) => u.includes('fallback'))).toBe(true);

      // Health and metrics say the failover happened without anyone asking.
      const snapshot = health();
      expect(snapshot.status).toBe('degraded');
      expect(snapshot.sources).toMatchObject({
        'indexer-primary': 'unavailable',
        'indexer-fallback': 'healthy',
      });

      const metrics = await request(app).get('/metrics');
      expect(metrics.text).toContain('oracle_source_health_state{source="indexer-primary"} 2');
      expect(metrics.text).toContain('oracle_failover_events_total{source="indexer-primary"} 1');

      // While the primary cools down, subsequent verifications skip it
      // entirely — the outage adds no latency to the request path.
      urls.length = 0;
      await request(app)
        .post('/v1/verify')
        .send({ ...VALID_BODY, invoiceId: 43 });
      expect(urls.every((u) => u.includes('fallback'))).toBe(true);
    } finally {
      await close();
    }
  });

  it('fails safe to empty history when every source is down, exactly as before', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('boom', { status: 500 })
    ) as unknown as typeof fetch;

    const { app, close } = await createOracleApp({
      indexerBaseUrl: 'http://primary.local',
      indexerFallbackUrl: 'http://fallback.local',
      historyProvider: undefined,
      reputationProvider: async () => makeReputation(Date.now(), { score: 90 }),
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);
      expect(res.status).toBe(200);
      expect(res.body.evidence.join(' ')).toMatch(/No payer history/);
    } finally {
      await close();
    }
  });

  it('without a configured fallback, behaves identically to a single source', async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;

    const { app, close, health } = await createOracleApp({
      indexerBaseUrl: 'http://primary.local',
      historyProvider: undefined,
      reputationProvider: async () => makeReputation(Date.now(), { score: 90 }),
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);
      expect(res.status).toBe(200);
      expect(urls).toHaveLength(1);
      // No failover machinery engaged: payload otherwise unchanged.
      expect(health().sources).toEqual({});
      expect(health().status).toBe('ok');
    } finally {
      await close();
    }
  });

  it('routes reputation traffic to the fallback RPC and back', async () => {
    rpcFailMode = 'primary';
    simulate.mockResolvedValue({ result: { retval: {} } });
    scValToNative.mockReturnValue({
      score: 77,
      total_paid: '1000',
      invoice_count: 2,
      last_activity: Math.floor(Date.now() / 1000),
      rank: 5,
    });

    const { app, close, health } = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => healthyHistory(Date.now()),
      reputationProvider: undefined,
      reputationRpcUrl: 'https://rpc-primary.example',
      reputationContractId: 'CCONTRACT',
      reputationFallbackRpcUrl: 'https://rpc-fallback.example',
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);
      expect(res.body.reputationScore).toBe(77);
      expect(getAccountCalls.some((c) => c.includes('primary'))).toBe(true);
      expect(getAccountCalls.some((c) => c.includes('fallback'))).toBe(true);
      expect(health().sources).toMatchObject({
        'reputation-primary': 'unavailable',
        'reputation-fallback': 'healthy',
      });

      // Anti-flap, live: even after the primary stops failing, the cooldown
      // keeps traffic on the fallback instead of bouncing back immediately.
      rpcFailMode = 'none';
      getAccountCalls.length = 0;
      const second = await request(app)
        .post('/v1/verify')
        .send({ ...VALID_BODY, invoiceId: 44 });
      expect(second.body.reputationScore).toBe(77);
      expect(getAccountCalls.every((c) => c.includes('fallback'))).toBe(true);
    } finally {
      await close();
    }
  });

  it('returns a zeroed reputation when every RPC is down', async () => {
    rpcFailMode = 'all';

    const { app, close } = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => [],
      reputationProvider: undefined,
      reputationRpcUrl: 'https://rpc-primary.example',
      reputationContractId: 'CCONTRACT',
      reputationFallbackRpcUrl: 'https://rpc-fallback.example',
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);
      expect(res.status).toBe(200);
      expect(res.body.reputationScore).toBe(0);
    } finally {
      await close();
    }
  });

  it('keeps a configured-but-solo reputation source working as before', async () => {
    rpcFailMode = 'none';
    simulate.mockResolvedValue({ result: { retval: {} } });
    scValToNative.mockReturnValue({ score: 61 });

    const { app, close, health } = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => healthyHistory(Date.now()),
      reputationProvider: undefined,
      reputationRpcUrl: 'https://rpc-primary.example',
      reputationContractId: 'CCONTRACT',
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);
      expect(res.body.reputationScore).toBe(61);
      // Solo source: no failover bookkeeping is done.
      expect(health().sources).toEqual({});
    } finally {
      await close();
    }
  });

  it('accepts explicit deltaBounds and sourceFailover option overrides', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('boom', { status: 500 })
    ) as unknown as typeof fetch;

    const { app, close, health } = await createOracleApp({
      indexerBaseUrl: 'http://primary.local',
      indexerFallbackUrl: 'http://fallback.local',
      historyProvider: undefined,
      reputationProvider: async () => makeReputation(Date.now(), { score: 90 }),
      sourceFailover: { ...FAST, cooldownMs: 60_000 },
      deltaBounds: {
        ...defaultDeltaBoundsConfig(),
        bounds: {
          ...defaultDeltaBoundsConfig().bounds,
          'composite-trust': { maxRelativeDelta: 0.1, maxAbsoluteDelta: 5, quorumSize: 3 },
        },
      },
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);
      expect(res.status).toBe(200);
      expect(res.body.deltaGuard.decision).toBe('publish');
      expect(health().sources?.['indexer-primary']).toBe('unavailable');
    } finally {
      await close();
    }
  });

  it('passes non-SDK payers through the address-format fallbacks', async () => {
    const { app, close } = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => [],
      reputationProvider: async () => makeReputation(Date.now(), { score: 90 }),
    });

    try {
      // Address.fromString rejects these; the regex fallbacks must not.
      for (const payer of ['GTESTABCDEF', 'AB:CD_EF']) {
        const res = await request(app)
          .post('/v1/verify')
          .send({ ...VALID_BODY, payer, invoiceId: 7 });
        expect(res.status).toBe(200);
      }
    } finally {
      await close();
    }
  });
});

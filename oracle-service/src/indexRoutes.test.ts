import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { createOracleApp, startOracleService } from './index';
import {
  TEST_PAYER,
  fraudulentHistory,
  healthyHistory,
  makeExternal,
  makeReputation,
} from './testFixtures';
import type { CreateOracleAppResult } from './index';

/**
 * HTTP surface and wiring for the oracle service: route behaviour, provider
 * construction, metrics emission and the cache-invalidation endpoint.
 */

const NOW = Date.now();
const VALID_BODY = { payer: TEST_PAYER, amount: '10000000', invoiceId: 42 };

let created: CreateOracleAppResult;

async function build(overrides: Parameters<typeof createOracleApp>[0] = {}) {
  created = await createOracleApp({
    indexerBaseUrl: 'http://indexer.local',
    historyProvider: async () => healthyHistory(NOW),
    reputationProvider: async () => makeReputation(NOW, { score: 90 }),
    ...overrides,
  });
  return created;
}

afterEach(async () => {
  await created?.close();
});

describe('health', () => {
  it('reports ok with cache kind and indexer url on both routes', async () => {
    const { app } = await build();

    for (const route of ['/health', '/v1/health']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', cache: 'memory', route });
    }
  });

  it('reports reputationConfigured when rpc url and contract id are both set', async () => {
    const { health } = await build({
      reputationRpcUrl: 'https://rpc.example',
      reputationContractId: 'CCONTRACT',
    });

    expect(health().reputationConfigured).toBe(true);
  });

  it('reports reputationConfigured false when only one is set', async () => {
    const { health } = await build({ reputationRpcUrl: 'https://rpc.example' });
    expect(health().reputationConfigured).toBe(false);
  });

  it('degrades after a verification throws', async () => {
    const { app, health } = await build({
      historyProvider: async () => {
        throw new Error('indexer down');
      },
      // The verifier tolerates a failing history provider, so force the throw
      // from a layer it cannot swallow.
      cache: {
        get: async () => {
          throw new Error('cache exploded');
        },
        set: async () => {},
      },
    });

    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Oracle verification failed');
    expect(res.body.message).toMatch(/cache exploded/);
    expect(health().status).toBe('degraded');
  });
});

describe('metrics endpoint', () => {
  it('serves prometheus exposition on both routes', async () => {
    const { app } = await build();

    for (const route of ['/metrics', '/v1/metrics']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('oracle_verification_requests_total');
    }
  });

  it('records outcome, cache and duration metrics for a verification', async () => {
    const { app } = await build();

    await request(app).post('/v1/verify').send(VALID_BODY);
    const first = await request(app).get('/metrics');

    expect(first.text).toMatch(/oracle_verification_requests_total 1/);
    expect(first.text).toContain('oracle_verification_outcome_total');
    expect(first.text).toMatch(/oracle_cache_misses_total 1/);

    // A second identical request is a cache hit.
    await request(app).post('/v1/verify').send(VALID_BODY);
    const second = await request(app).get('/metrics');
    expect(second.text).toMatch(/oracle_cache_hits_total 1/);
  });

  it('records fraud signals when the heuristics fire', async () => {
    const { app } = await build({ historyProvider: async () => fraudulentHistory(NOW) });

    await request(app).post('/v1/verify').send(VALID_BODY);
    const res = await request(app).get('/metrics');

    expect(res.text).toContain('oracle_fraud_signal_total');
    expect(res.text).toMatch(/oracle_fraud_flag_ratio 1/);
  });

  it('counts a stale response', async () => {
    const { app } = await build({
      maxOracleAgeMs: 1,
      historyProvider: async () => healthyHistory(NOW - 10 * 24 * 60 * 60 * 1000),
      reputationProvider: async () =>
        makeReputation(NOW - 10 * 24 * 60 * 60 * 1000, { score: 90 }),
    });

    await request(app).post('/v1/verify').send(VALID_BODY);
    const res = await request(app).get('/metrics');

    expect(res.text).toMatch(/oracle_stale_responses_total 1/);
  });
});

describe('POST /verify validation', () => {
  it('accepts the unversioned /verify route', async () => {
    const { app } = await build();
    const res = await request(app).post('/verify').send(VALID_BODY);
    expect(res.status).toBe(200);
  });

  it.each([
    ['missing payer', { amount: '1', invoiceId: 1 }],
    ['missing amount', { payer: TEST_PAYER, invoiceId: 1 }],
    ['missing invoiceId', { payer: TEST_PAYER, amount: '1' }],
    ['null invoiceId', { payer: TEST_PAYER, amount: '1', invoiceId: null }],
    ['empty body', {}],
  ])('rejects %s with 400', async (_label, body) => {
    const { app } = await build();
    const res = await request(app).post('/v1/verify').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('rejects a malformed stellar address', async () => {
    const { app } = await build();
    const res = await request(app)
      .post('/v1/verify')
      .send({ ...VALID_BODY, payer: 'not-an-address' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid Stellar address/);
  });

  it('accepts the invoiceAmount and invoice_id aliases', async () => {
    const { app } = await build();
    const res = await request(app)
      .post('/v1/verify')
      .send({ payer: TEST_PAYER, invoiceAmount: '10000000', invoice_id: 7 });

    expect(res.status).toBe(200);
    expect(res.body.invoiceId).toBe('7');
  });

  it.each([[true], ['true'], [1], ['1']])(
    'treats forceRefresh=%p as truthy',
    async (forceRefresh) => {
      let calls = 0;
      const { app } = await build({
        historyProvider: async () => {
          calls += 1;
          return healthyHistory(NOW);
        },
      });

      await request(app).post('/v1/verify').send(VALID_BODY);
      await request(app)
        .post('/v1/verify')
        .send({ ...VALID_BODY, forceRefresh });

      expect(calls).toBe(2);
    }
  );

  it('honours a numeric maxOracleAgeMs override from the body', async () => {
    const { app } = await build();
    const res = await request(app)
      .post('/v1/verify')
      .send({ ...VALID_BODY, maxOracleAgeMs: 1 });

    expect(res.status).toBe(200);
    expect(res.body.composition.outcome).toBe('rejected-stale-data');
  });

  it('rejects GET /v1/verify with 405', async () => {
    const { app } = await build();
    const res = await request(app).get('/v1/verify');

    expect(res.status).toBe(405);
    expect(res.body.error).toMatch(/Use POST/);
  });
});

describe('composition surfaced over HTTP', () => {
  it('returns both sub-scores so the badge can distinguish cases', async () => {
    const { app } = await build({
      externalProvider: async () => makeExternal({ status: 'verified', provider: 'acme-kyb' }),
    });

    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.body.composition.outcome).toBe('verified-both');
    expect(res.body.composition.heuristic.passed).toBe(true);
    expect(res.body.composition.external).toMatchObject({
      status: 'verified',
      provider: 'acme-kyb',
    });
  });

  it('reports a KYB-verified payer that trips fraud heuristics as rejected', async () => {
    const { app } = await build({
      historyProvider: async () => fraudulentHistory(NOW),
      externalProvider: async () => makeExternal({ status: 'verified' }),
    });

    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.body.isVerified).toBe(false);
    expect(res.body.composition.outcome).toBe('rejected-fraud-signals');
    expect(res.body.composition.external.status).toBe('verified');
  });
});

describe('POST /v1/cache/invalidate', () => {
  it('drops cached verdicts for the payer', async () => {
    const { app } = await build();

    await request(app).post('/v1/verify').send(VALID_BODY);
    const res = await request(app).post('/v1/cache/invalidate').send({ payer: TEST_PAYER });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ payer: TEST_PAYER, invalidated: 1 });

    // The next request recomputes rather than serving the dropped entry.
    const after = await request(app).post('/v1/verify').send(VALID_BODY);
    expect(after.body.cacheHit).toBe(false);
  });

  it('rejects a malformed or missing payer', async () => {
    const { app } = await build();

    for (const body of [{}, { payer: '' }, { payer: 'nope' }]) {
      const res = await request(app).post('/v1/cache/invalidate').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid Stellar address/);
    }
  });

  it('reports zero when nothing was cached for that payer', async () => {
    const { app } = await build();
    const res = await request(app).post('/v1/cache/invalidate').send({ payer: TEST_PAYER });

    expect(res.body.invalidated).toBe(0);
  });
});

describe('default providers', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches payer history from the indexer', async () => {
    const entries = [
      {
        id: 1,
        freelancer: 'GF',
        payer: TEST_PAYER,
        amount: '10000000',
        due_date: 0,
        discount_rate: 300,
        status: 'Paid',
        funder: 'GU',
        funded_at: 1,
        created_at: 2,
        updated_at: 3,
      },
    ];
    const fetchMock = vi.fn(async (_url: unknown) =>
      new Response(JSON.stringify(entries), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { app } = await build({ historyProvider: undefined });
    await request(app).post('/v1/verify').send(VALID_BODY);

    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v1/history/');
    expect(url).toContain('role=payer');
  });

  it('normalizes missing history fields to defaults', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify([{}]), { status: 200 })
    ) as unknown as typeof fetch;

    const { app } = await build({ historyProvider: undefined });
    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.status).toBe(200);
  });

  it('falls back to empty history when the indexer errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const { app } = await build({ historyProvider: undefined });
    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.evidence.join(' ')).toMatch(/No payer history/);
  });

  it('falls back to empty history when the indexer returns a non-array', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ nope: true }), { status: 200 })
    ) as unknown as typeof fetch;

    const { app } = await build({ historyProvider: undefined });
    expect((await request(app).post('/v1/verify').send(VALID_BODY)).status).toBe(200);
  });

  it('strips a trailing slash from the indexer base url', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => new Response('[]', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { app } = await build({
      historyProvider: undefined,
      indexerBaseUrl: 'http://indexer.local///',
    });
    await request(app).post('/v1/verify').send(VALID_BODY);

    expect(String(fetchMock.mock.calls[0][0])).toContain('http://indexer.local/v1/history/');
  });

  it('returns a zeroed reputation when the contract is not configured', async () => {
    const { app } = await build({ reputationProvider: undefined });
    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.body.reputationScore).toBe(0);
  });
});

describe('option resolution', () => {
  const envKeys = [
    'ORACLE_PORT',
    'INDEXER_BASE_URL',
    'ORACLE_CACHE_TTL_SECONDS',
    'ORACLE_REQUEST_TIMEOUT_MS',
    'ORACLE_MAX_ORACLE_AGE_MS',
    'ORACLE_REPUTATION_RPC_URL',
    'ORACLE_REPUTATION_CONTRACT_ID',
    'REDIS_URL',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('reads defaults from the environment', async () => {
    process.env.INDEXER_BASE_URL = 'http://from-env.local';
    const { health } = await build({ indexerBaseUrl: undefined });

    expect(health().indexerBaseUrl).toBe('http://from-env.local');
  });

  it('prefers explicit options over the environment', async () => {
    process.env.INDEXER_BASE_URL = 'http://from-env.local';
    const { health } = await build({ indexerBaseUrl: 'http://explicit.local' });

    expect(health().indexerBaseUrl).toBe('http://explicit.local');
  });

  it('falls back to the built-in indexer url when neither is set', async () => {
    delete process.env.INDEXER_BASE_URL;
    const { health } = await build({ indexerBaseUrl: undefined });

    expect(health().indexerBaseUrl).toBe('http://localhost:3001');
  });
});

describe('startOracleService', () => {
  it('binds the configured port and logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Port 0 lets the OS pick a free port, so this never collides in CI.
    const server = await startOracleService({
      port: 0,
      historyProvider: async () => [],
      reputationProvider: async () => makeReputation(NOW),
    });

    expect(server.listening).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[oracle] listening on'));

    log.mockRestore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createOracleApp } from './index';
import { TEST_PAYER, healthyHistory, makeReputation } from './testFixtures';
import type { IndexerInvoiceHistoryEntry, ReputationSnapshot } from './types';

// A real 56-character Stellar public key. The previous literal was 55
// characters, so `isValidStellarAddress` rejected every request as malformed.
const payer = TEST_PAYER;

// Anchored to the current clock so the fixtures never age past
// `maxOracleAgeMs` and silently turn every verdict stale.
const NOW = Date.now();

const history: IndexerInvoiceHistoryEntry[] = healthyHistory(NOW);

const reputation: ReputationSnapshot = makeReputation(NOW, { score: 90 });

let app: Awaited<ReturnType<typeof createOracleApp>>['app'];
let closeApp: Awaited<ReturnType<typeof createOracleApp>>['close'];
let historyCalls = 0;
let reputationCalls = 0;

beforeEach(async () => {
  historyCalls = 0;
  reputationCalls = 0;

  const created = await createOracleApp({
    indexerBaseUrl: 'http://indexer.local',
    historyProvider: async () => {
      historyCalls += 1;
      return history;
    },
    reputationProvider: async () => {
      reputationCalls += 1;
      return reputation;
    },
  });

  app = created.app;
  closeApp = created.close;
});

afterEach(async () => {
  await closeApp?.();
});

describe('oracle service HTTP API', () => {
  it('returns health metadata', async () => {
    const res = await request(app).get('/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.indexerBaseUrl).toBe('http://indexer.local');
    expect(res.body.cache).toBe('memory');
  });

  it('verifies a payer and returns a trust score', async () => {
    const res = await request(app).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 42,
      requestId: 'oracle-test-1',
    });

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe('oracle-test-1');
    expect(res.body.payer).toBe(payer);
    expect(res.body.trustScore).toBeGreaterThan(70);
    expect(res.body.confidenceLevel).toBe('high');
    expect(res.body.cacheHit).toBe(false);
    expect(historyCalls).toBe(1);
    expect(reputationCalls).toBe(1);
  });

  it('serves repeated requests from cache', async () => {
    await request(app).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 42,
    });

    const res = await request(app).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 42,
    });

    expect(res.status).toBe(200);
    expect(res.body.cacheHit).toBe(true);
    expect(historyCalls).toBe(1);
    expect(reputationCalls).toBe(1);
  });

  it('allows forceRefresh to bypass cache', async () => {
    await request(app).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 42,
    });

    const res = await request(app).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 42,
      forceRefresh: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.cacheHit).toBe(false);
    expect(historyCalls).toBe(2);
    expect(reputationCalls).toBe(2);
  });

  it('rejects malformed requests', async () => {
    const res = await request(app).post('/v1/verify').send({
      payer: 'not-a-stellar-address',
      amount: '10000000',
      invoiceId: 42,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid Stellar address/);
  });
});

describe('oracle service rate limiting', () => {
  let appWithRateLimit: Awaited<ReturnType<typeof createOracleApp>>['app'];
  let closeAppRateLimit: Awaited<ReturnType<typeof createOracleApp>>['close'];

  beforeEach(async () => {
    const created = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => history,
      reputationProvider: async () => reputation,
      rateLimitWindowMs: 1000, // 1 second for testing
      rateLimitMaxRequests: 3, // 3 requests per second
      enableRateLimit: true,
    });

    appWithRateLimit = created.app;
    closeAppRateLimit = created.close;
  });

  afterEach(async () => {
    await closeAppRateLimit?.();
  });

  it('allows requests within rate limit', async () => {
    const res1 = await request(appWithRateLimit).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 1,
    });
    const res2 = await request(appWithRateLimit).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 2,
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it('blocks requests exceeding rate limit', async () => {
    // Make requests up to the limit
    for (let i = 0; i < 3; i += 1) {
      const res = await request(appWithRateLimit).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: i,
      });
      expect(res.status).toBe(200);
    }

    // Next request should be blocked
    const blocked = await request(appWithRateLimit).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 99,
    });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('Rate limit exceeded');
    expect(blocked.body.retryAfter).toBeDefined();
  });

  it('resets rate limit after time window expires', async () => {
    // Make requests up to the limit
    for (let i = 0; i < 3; i += 1) {
      const res = await request(appWithRateLimit).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: i,
      });
      expect(res.status).toBe(200);
    }

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should allow new requests
    const res = await request(appWithRateLimit).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 100,
    });

    expect(res.status).toBe(200);
  });
});

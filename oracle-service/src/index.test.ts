import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createOracleApp } from './index';
import type { IndexerInvoiceHistoryEntry, ReputationSnapshot } from './types';

const payer = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';

const history: IndexerInvoiceHistoryEntry[] = [
  {
    id: 1,
    freelancer: 'G1',
    payer,
    amount: '10000000',
    due_date: 0,
    discount_rate: 300,
    status: 'Paid',
    funder: 'G2',
    funded_at: 1_700_000_000,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_250_000_000,
  },
  {
    id: 2,
    freelancer: 'G1',
    payer,
    amount: '10100000',
    due_date: 0,
    discount_rate: 300,
    status: 'Paid',
    funder: 'G2',
    funded_at: 1_700_300_000,
    created_at: 1_700_300_000_000,
    updated_at: 1_700_550_000_000,
  },
];

const reputation: ReputationSnapshot = {
  address: payer,
  score: 90,
  totalPaid: 20_000_000n,
  invoiceCount: 2,
  lastActivity: 1_700_550_000,
  rank: 3,
};

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

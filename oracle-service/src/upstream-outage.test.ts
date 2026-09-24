import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createOracleApp } from './index';
import request from 'supertest';
import type { OracleVerificationResponse } from './types';
import { createEphemeralOracleCache } from './cache';

describe('Upstream Outage Chaos Test', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('triggers staleness circuit breaker and failover under simulated upstream outage', async () => {
    const mockHistoryProvider = vi.fn().mockResolvedValue([
      { status: 'Paid', amount: '10000', funded_at: Date.now() - 100000 }
    ]);
    const mockReputationProvider = vi.fn().mockResolvedValue({
      address: 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S',
      score: 95,
      totalPaid: 10000n,
      invoiceCount: 1,
      lastActivity: Date.now() - 100000
    });

    const cache = createEphemeralOracleCache();
    const { app, close } = await createOracleApp({
      historyProvider: mockHistoryProvider,
      reputationProvider: mockReputationProvider,
      maxOracleAgeMs: 5000,
      cacheTtlSeconds: 300,
      cache,
    });

    // 1. Initial successful request
    let res = await request(app)
      .post('/v1/verify')
      .send({
        payer: 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S',
        amount: '10000',
        invoiceId: 1
      });
    expect(res.status).toBe(200);
    expect(res.body.isVerified).toBe(true);
    expect(res.body.cacheHit).toBe(false);

    // 2. Simulate upstream outage (connection refused / 5xx)
    mockHistoryProvider.mockRejectedValue(new Error('Connection refused'));
    mockReputationProvider.mockRejectedValue(new Error('503 Service Unavailable'));

    // 3. Failover behavior: returns cached result immediately (circuit breaker/failover)
    res = await request(app)
      .post('/v1/verify')
      .send({
        payer: 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S',
        amount: '10000',
        invoiceId: 1
      });
    expect(res.status).toBe(200);
    expect(res.body.isVerified).toBe(true);
    expect(res.body.cacheHit).toBe(true);

    // 4. Staleness circuit breaker: force refresh during outage
    res = await request(app)
      .post('/v1/verify')
      .send({
        payer: 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S',
        amount: '10000',
        invoiceId: 1,
        forceRefresh: true
      });
    
    // Upstreams fail, fallback to empty data, causing it to fail verification due to staleness/no-data
    expect(res.status).toBe(200);
    expect(res.body.isVerified).toBe(false);
    expect(res.body.trustScore).toBe(0);

    await close();
  });
});

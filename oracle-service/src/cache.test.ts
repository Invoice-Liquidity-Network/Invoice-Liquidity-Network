import { beforeEach, describe, expect, it } from 'vitest';

import { buildOracleCacheKey, createOracleCache } from './cache';
import type { OracleVerificationRequest, OracleVerificationResponse } from './types';

const request: OracleVerificationRequest = {
  payer: 'GBTESTPAYERTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  amount: '10000000',
  invoiceId: '42',
};

function makeResponse(overrides: Partial<OracleVerificationResponse> = {}): OracleVerificationResponse {
  return {
    requestId: 'req-1',
    payer: request.payer,
    invoiceId: String(request.invoiceId),
    amount: String(request.amount),
    trustScore: 88,
    confidence: 0.92,
    confidenceLevel: 'high',
    isVerified: true,
    generatedAt: new Date().toISOString(),
    dataAgeMs: 0,
    cacheHit: false,
    reputationScore: 91,
    historicalSuccessRate: 0.95,
    historicalDefaultRate: 0.05,
    averageHistoricalAmount: '10000000',
    amountDeviation: 0,
    settlementVarianceDays: 1.2,
    fraudSignals: [],
    evidence: ['ok'],
    ...overrides,
  };
}

describe('oracle cache', () => {
  it('builds stable cache keys for repeated requests', () => {
    expect(buildOracleCacheKey(request)).toBe(buildOracleCacheKey(request));
  });

  it('stores and retrieves cached responses in memory mode', async () => {
    const cache = await createOracleCache();
    const response = makeResponse();

    await cache.cache.set(buildOracleCacheKey(request), response, 5);
    const cached = await cache.cache.get(buildOracleCacheKey(request));

    expect(cached).not.toBeNull();
    expect(cached?.response.trustScore).toBe(88);
    expect(cached?.response.isVerified).toBe(true);

    await cache.close();
  });
});

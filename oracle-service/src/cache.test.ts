import { beforeEach, describe, expect, it } from 'vitest';

import { buildOracleCacheKey, createOracleCache } from './cache';
import { TEST_PAYER, makeResponse } from './testFixtures';
import type { OracleVerificationRequest } from './types';

const request: OracleVerificationRequest = {
  payer: TEST_PAYER,
  amount: '10000000',
  invoiceId: '42',
};

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

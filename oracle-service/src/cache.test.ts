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

  it('serves last-known-good via getStale after the TTL expires', async () => {
    const cache = await createOracleCache();
    const response = makeResponse();

    await cache.cache.set(buildOracleCacheKey(request), response, 5);
    // Expire the live entry by writing it with a TTL in the past: the
    // fresh read misses while the stale read still serves last-known-good.
    await cache.cache.set(buildOracleCacheKey(request), response, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(await cache.cache.get(buildOracleCacheKey(request))).toBeNull();
    const stale = await cache.cache.getStale(buildOracleCacheKey(request));
    expect(stale).not.toBeNull();
    expect(stale?.response.trustScore).toBe(88);

    await cache.close();
  });

  it('returns null from getStale for keys that were never written', async () => {
    const cache = await createOracleCache();
    expect(await cache.cache.getStale('oracle:v1:nobody:0:0')).toBeNull();
    await cache.close();
  });
});

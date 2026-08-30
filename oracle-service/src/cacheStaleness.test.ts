import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TTL_SECONDS,
  VOLATILE_CLEAN_TTL_SECONDS,
  buildOracleCacheKey,
  buildOraclePayerKeyPrefix,
  createEphemeralOracleCache,
  resolveCacheTtlSeconds,
} from './cache';
import { OracleVerifier, hasRecentActivity } from './verifier';
import {
  DAY_MS,
  TEST_PAYER,
  fraudulentHistory,
  healthyHistory,
  makeHistoryEntry,
  makeReputation,
  makeResponse,
} from './testFixtures';
import type { IndexerInvoiceHistoryEntry, OracleVerificationRequest } from './types';

/**
 * Cache staleness audit (see the policy note on VOLATILE_CLEAN_TTL_SECONDS).
 *
 * The risk: fraud heuristics look at a rolling activity window, so a "clean"
 * verdict is only true as of the instant it was computed. Cached for the full
 * five minutes, it becomes a window in which a payer who has *just* started
 * behaving fraudulently still reads as clean.
 *
 * The mitigation is asymmetric — clean verdicts for active payers get a short
 * TTL, flagged verdicts keep the full one — plus explicit per-payer
 * invalidation. Both halves are exercised below.
 */

const request: OracleVerificationRequest = {
  payer: TEST_PAYER,
  amount: '10000000',
  invoiceId: '42',
};

describe('resolveCacheTtlSeconds', () => {
  it('shortens the TTL for a clean verdict on an actively-invoicing payer', () => {
    const ttl = resolveCacheTtlSeconds(
      { isVerified: true, fraudSignals: [] },
      DEFAULT_TTL_SECONDS,
      true
    );

    expect(ttl).toBe(VOLATILE_CLEAN_TTL_SECONDS);
    expect(ttl).toBeLessThan(DEFAULT_TTL_SECONDS);
  });

  it('keeps the full TTL for a clean verdict on a dormant payer', () => {
    // No recent activity means no new invoices to invalidate the verdict, so
    // the short TTL would buy nothing but load.
    expect(
      resolveCacheTtlSeconds({ isVerified: true, fraudSignals: [] }, DEFAULT_TTL_SECONDS, false)
    ).toBe(DEFAULT_TTL_SECONDS);
  });

  it('keeps the full TTL for a flagged verdict, which fails safe when stale', () => {
    // A stale "flagged" reads a good actor as bad: it costs a re-check, not
    // funds. It also stops an attacker re-querying to grind out a clean result.
    expect(
      resolveCacheTtlSeconds(
        { isVerified: false, fraudSignals: ['Rapid succession of invoices'] },
        DEFAULT_TTL_SECONDS,
        true
      )
    ).toBe(DEFAULT_TTL_SECONDS);
  });

  it('keeps the full TTL for an unverified-but-unflagged verdict', () => {
    expect(
      resolveCacheTtlSeconds({ isVerified: false, fraudSignals: [] }, DEFAULT_TTL_SECONDS, true)
    ).toBe(DEFAULT_TTL_SECONDS);
  });

  it('never lengthens a TTL that is already shorter than the volatile floor', () => {
    expect(resolveCacheTtlSeconds({ isVerified: true, fraudSignals: [] }, 5, true)).toBe(5);
  });
});

describe('hasRecentActivity', () => {
  const now = Date.now();

  it('is true for an invoice inside the rapid-succession window', () => {
    expect(hasRecentActivity([makeHistoryEntry(now, { agoMs: 60_000 })], now)).toBe(true);
  });

  it('is false for history entirely outside the window', () => {
    expect(hasRecentActivity(healthyHistory(now), now)).toBe(false);
  });

  it('is false for empty history', () => {
    expect(hasRecentActivity([], now)).toBe(false);
  });

  it('ignores entries with unusable timestamps', () => {
    const broken: IndexerInvoiceHistoryEntry = makeHistoryEntry(now, {
      created_at: 0,
      updated_at: 0,
      funded_at: null,
    });

    expect(hasRecentActivity([broken], now)).toBe(false);
  });

  it('uses whichever of created_at / updated_at is newer', () => {
    const updatedRecently = makeHistoryEntry(now, {
      created_at: now - 40 * DAY_MS,
      updated_at: now - 60_000,
    });

    expect(hasRecentActivity([updatedRecently], now)).toBe(true);
  });
});

describe('the exploit window this closes', () => {
  /** Build a verifier whose history provider can be swapped mid-test. */
  function makeVerifier(now: number, history: () => IndexerInvoiceHistoryEntry[]) {
    const cache = createEphemeralOracleCache();
    const verifier = new OracleVerifier({
      cache,
      now: () => now,
      cacheTtlSeconds: DEFAULT_TTL_SECONDS,
      maxOracleAgeMs: 0,
      historyProvider: async () => history(),
      reputationProvider: async () => makeReputation(now, { score: 95 }),
    });
    return { cache, verifier };
  }

  it('caches a clean verdict for an active payer with the short TTL, not 300s', async () => {
    const now = Date.now();
    let observedTtl = -1;

    const cache = createEphemeralOracleCache();
    const spy = {
      get: cache.get.bind(cache),
      set: async (key: string, response: Parameters<typeof cache.set>[1], ttl: number) => {
        observedTtl = ttl;
        return cache.set(key, response, ttl);
      },
    };

    const verifier = new OracleVerifier({
      cache: spy,
      now: () => now,
      cacheTtlSeconds: DEFAULT_TTL_SECONDS,
      maxOracleAgeMs: 0,
      // Clean history, but the payer invoiced an hour ago — active.
      historyProvider: async () => [
        ...healthyHistory(now),
        makeHistoryEntry(now, { id: 99, agoMs: 60 * 60 * 1000, amount: '4100000' }),
      ],
      reputationProvider: async () => makeReputation(now, { score: 95 }),
    });

    const response = await verifier.verify(request);

    expect(response.isVerified).toBe(true);
    expect(response.fraudSignals).toEqual([]);
    expect(observedTtl).toBe(VOLATILE_CLEAN_TTL_SECONDS);
  });

  it('serves a flagged verdict from cache for the full TTL', async () => {
    const now = Date.now();
    let observedTtl = -1;

    const cache = createEphemeralOracleCache();
    const verifier = new OracleVerifier({
      cache: {
        get: cache.get.bind(cache),
        set: async (key, response, ttl) => {
          observedTtl = ttl;
          return cache.set(key, response, ttl);
        },
      },
      now: () => now,
      cacheTtlSeconds: DEFAULT_TTL_SECONDS,
      maxOracleAgeMs: 0,
      historyProvider: async () => fraudulentHistory(now),
      reputationProvider: async () => makeReputation(now, { score: 95 }),
    });

    const response = await verifier.verify(request);

    expect(response.isVerified).toBe(false);
    expect(response.fraudSignals.length).toBeGreaterThan(0);
    expect(observedTtl).toBe(DEFAULT_TTL_SECONDS);
  });

  it('stops serving the clean verdict once the payer is invalidated', async () => {
    const now = Date.now();
    let history = healthyHistory(now);
    const { verifier } = makeVerifier(now, () => history);

    const first = await verifier.verify(request);
    expect(first.isVerified).toBe(true);
    expect(first.cacheHit).toBe(false);

    // Same request again — served from cache, still clean.
    const cached = await verifier.verify(request);
    expect(cached.cacheHit).toBe(true);
    expect(cached.isVerified).toBe(true);

    // The payer now starts exhibiting fraud patterns. Without invalidation the
    // cached clean verdict would keep being served for the rest of the TTL.
    history = fraudulentHistory(now);
    const removed = await verifier.invalidatePayer(request.payer);
    expect(removed).toBeGreaterThan(0);

    const rechecked = await verifier.verify(request);
    expect(rechecked.cacheHit).toBe(false);
    expect(rechecked.isVerified).toBe(false);
    expect(rechecked.fraudSignals.length).toBeGreaterThan(0);
  });

  it('demonstrates the gap: without invalidation the stale clean verdict persists', async () => {
    const now = Date.now();
    let history = healthyHistory(now);
    const { verifier } = makeVerifier(now, () => history);

    await verifier.verify(request);
    history = fraudulentHistory(now);

    // No invalidation call — this is the pre-fix behaviour, and it is exactly
    // why the short TTL matters as the second line of defence.
    const stale = await verifier.verify(request);
    expect(stale.cacheHit).toBe(true);
    expect(stale.isVerified).toBe(true);

    // forceRefresh is the caller-side escape hatch and must always re-compute.
    const forced = await verifier.verify({ ...request, forceRefresh: true });
    expect(forced.isVerified).toBe(false);
  });

  it('invalidates every invoice cached for the payer, not just one', async () => {
    const now = Date.now();
    const { cache, verifier } = makeVerifier(now, () => healthyHistory(now));

    await verifier.verify({ ...request, invoiceId: '1' });
    await verifier.verify({ ...request, invoiceId: '2' });
    await verifier.verify({ ...request, invoiceId: '3' });

    const removed = await verifier.invalidatePayer(request.payer);
    expect(removed).toBe(3);

    expect(await cache.get(buildOracleCacheKey({ ...request, invoiceId: '1' }))).toBeNull();
    expect(await cache.get(buildOracleCacheKey({ ...request, invoiceId: '3' }))).toBeNull();
  });

  it('leaves other payers untouched when one is invalidated', async () => {
    const cache = createEphemeralOracleCache();
    const other = 'GA6HCMBLTZS5VYYBCATRBRZ3BZJMAFUDKYYF6AH6MVCMGWMRDNSWJPIH';

    await cache.set(buildOracleCacheKey(request), makeResponse(), 300);
    await cache.set(buildOracleCacheKey({ ...request, payer: other }), makeResponse(), 300);

    const removed = await cache.invalidateByPrefix?.(buildOraclePayerKeyPrefix(request.payer));
    expect(removed).toBe(1);

    expect(await cache.get(buildOracleCacheKey({ ...request, payer: other }))).not.toBeNull();
  });

  it('reports 0 removals when the cache cannot invalidate', async () => {
    const now = Date.now();
    const verifier = new OracleVerifier({
      // A minimal cache implementation without invalidateByPrefix — absence
      // must read as "unsupported", not as a silent success.
      cache: { get: async () => null, set: async () => {} },
      now: () => now,
      historyProvider: async () => [],
      reputationProvider: async () => makeReputation(now),
    });

    expect(await verifier.invalidatePayer(request.payer)).toBe(0);
  });
});

describe('payer key prefix', () => {
  it('prefixes every cache key for that payer', () => {
    const prefix = buildOraclePayerKeyPrefix(request.payer);

    expect(buildOracleCacheKey(request).startsWith(prefix)).toBe(true);
    expect(buildOracleCacheKey({ ...request, invoiceId: '999' }).startsWith(prefix)).toBe(true);
  });

  it('normalizes case and whitespace the same way keys do', () => {
    expect(buildOraclePayerKeyPrefix(`  ${request.payer.toUpperCase()}  `)).toBe(
      buildOraclePayerKeyPrefix(request.payer)
    );
  });
});

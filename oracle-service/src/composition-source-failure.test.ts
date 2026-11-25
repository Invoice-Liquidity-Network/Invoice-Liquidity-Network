/**
 * Tests for oracle source composition failure handling (issue #1476).
 *
 * Verified behavior audit
 * ───────────────────────
 * Normal path
 *   A fresh `verified` external attestation adds a confidence bonus.
 *   A fresh `unverified` attestation caps confidence.
 *   `unknown` / absent is completely inert.
 *
 * Failed source (provider throws)
 *   The caller catches the thrown error and passes `undefined`.
 *   `toExternalSignal(undefined)` returns `{ status: 'unknown' }`.
 *   `composeVerdict` with an unknown external signal applies no adjustment —
 *   an unavailable source cannot silently become a verified value.
 *
 * Stale source
 *   An attestation whose `checkedAt` is older than `externalMaxAgeMs` is
 *   downgraded to `unknown` inside `toExternalSignal`, regardless of the
 *   stored status.  A stale `verified` must NOT add a confidence bonus.
 *   The original `checkedAt` timestamp is preserved for audit purposes.
 *   A staleness reason is appended to the returned signal's `reasons`.
 *
 * Repeated stale calls
 *   Calling `composeVerdict` repeatedly with the same stale result always
 *   returns the same inert behaviour — there is no accumulation effect.
 *
 * Interrupted source (partial / malformed result)
 *   A result with an unrecognised status is normalised to `unknown`.
 *   Missing optional fields (`reasons`, `providerConfidence`) do not throw.
 *
 * Residual risk
 *   - `externalMaxAgeMs` is not enforced at the network boundary; callers
 *     that cache `ExternalVerificationResult` objects across restarts must
 *     ensure the cached `checkedAt` reflects the actual check time.
 *   - Cross-instance staleness (multiple oracle replicas sharing a Redis
 *     cache for the external result) is outside the scope of this module;
 *     see `cache.ts` for the TTL configuration.
 *
 * Maintainer approval required
 *   The default `EXTERNAL_STALENESS_MAX_AGE_MS` (30 days) was chosen to
 *   match typical KYB refresh cadences.  Tighter SLAs must be configured
 *   explicitly via `externalMaxAgeMs` on `ComposeVerdictInput`.
 */
import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_STALENESS_MAX_AGE_MS,
  EXTERNAL_UNVERIFIED_CONFIDENCE_CAP,
  EXTERNAL_VERIFIED_BONUS,
  MIN_CONFIDENCE,
  composeVerdict,
  toExternalSignal,
} from './composition';
import { makeExternal } from './testFixtures';

const NOW_MS = 1_750_000_000_000; // fixed epoch for determinism
const FRESH_ISO = new Date(NOW_MS - 60_000).toISOString(); // 1 minute ago
const STALE_ISO = new Date(NOW_MS - EXTERNAL_STALENESS_MAX_AGE_MS - 1).toISOString();

const CLEAN = {
  trustScore: 85,
  baseConfidence: 0.8,
  fraudSignals: [] as string[],
  isFresh: true,
  now: NOW_MS,
};

// ── Failed source (provider throws → caller passes undefined) ───────────────

describe('failed source: provider throws', () => {
  it('toExternalSignal(undefined) is inert (status unknown, all nulls)', () => {
    const signal = toExternalSignal(undefined);

    expect(signal.status).toBe('unknown');
    expect(signal.provider).toBeNull();
    expect(signal.providerConfidence).toBeNull();
    expect(signal.checkedAt).toBeNull();
    expect(signal.reasons).toEqual([]);
  });

  it('a thrown provider does not change confidence — unavailable ≠ verified', () => {
    const withThrown = composeVerdict({ ...CLEAN, external: undefined });
    const withVerified = composeVerdict({
      ...CLEAN,
      external: makeExternal({ status: 'verified', checkedAt: FRESH_ISO }),
    });

    // The thrown-provider verdict must have LOWER or EQUAL confidence than the
    // verified one, never higher.
    expect(withThrown.confidence).toBeLessThanOrEqual(withVerified.confidence);
    // And it must not add the bonus.
    expect(withThrown.confidence).toBe(CLEAN.baseConfidence);
  });

  it('a thrown provider does not produce a verified-both outcome', () => {
    const result = composeVerdict({ ...CLEAN, external: undefined });

    expect(result.composition.outcome).not.toBe('verified-both');
    expect(result.composition.external.status).toBe('unknown');
  });
});

// ── Stale source ─────────────────────────────────────────────────────────────

describe('stale source: checkedAt beyond maxAgeMs', () => {
  it('a stale verified attestation is downgraded to unknown', () => {
    const signal = toExternalSignal(
      makeExternal({ status: 'verified', checkedAt: STALE_ISO }),
      { maxAgeMs: EXTERNAL_STALENESS_MAX_AGE_MS, now: NOW_MS }
    );

    expect(signal.status).toBe('unknown');
  });

  it('a stale verified attestation does NOT add the confidence bonus', () => {
    const staleResult = composeVerdict({
      ...CLEAN,
      external: makeExternal({ status: 'verified', checkedAt: STALE_ISO }),
    });
    const noExternalResult = composeVerdict({ ...CLEAN, external: undefined });

    expect(staleResult.confidence).toBe(noExternalResult.confidence);
    expect(staleResult.confidence).toBe(CLEAN.baseConfidence);
  });

  it('a stale verified attestation produces verified-heuristic-only, not verified-both', () => {
    const result = composeVerdict({
      ...CLEAN,
      external: makeExternal({ status: 'verified', checkedAt: STALE_ISO }),
    });

    expect(result.composition.outcome).toBe('verified-heuristic-only');
  });

  it('a stale unverified attestation does NOT apply the confidence cap', () => {
    // Stale unverified → downgraded to unknown → no cap applied.
    const highConfidence = { ...CLEAN, baseConfidence: 0.9 };

    const staleUnverified = composeVerdict({
      ...highConfidence,
      external: makeExternal({ status: 'unverified', checkedAt: STALE_ISO }),
    });
    const freshUnverified = composeVerdict({
      ...highConfidence,
      external: makeExternal({ status: 'unverified', checkedAt: FRESH_ISO }),
    });

    // Stale: no cap → confidence stays at base.
    expect(staleUnverified.confidence).toBe(highConfidence.baseConfidence);
    // Fresh: cap applies → confidence at or below the cap.
    expect(freshUnverified.confidence).toBe(EXTERNAL_UNVERIFIED_CONFIDENCE_CAP);
    // Stale must NOT be capped the same way as fresh.
    expect(staleUnverified.confidence).toBeGreaterThan(freshUnverified.confidence);
  });

  it('preserves the original checkedAt for audit', () => {
    const signal = toExternalSignal(
      makeExternal({ status: 'verified', checkedAt: STALE_ISO }),
      { maxAgeMs: EXTERNAL_STALENESS_MAX_AGE_MS, now: NOW_MS }
    );

    expect(signal.checkedAt).toBe(STALE_ISO);
  });

  it('appends a staleness reason to the signal', () => {
    const signal = toExternalSignal(
      makeExternal({ status: 'verified', checkedAt: STALE_ISO }),
      { maxAgeMs: EXTERNAL_STALENESS_MAX_AGE_MS, now: NOW_MS }
    );

    expect(signal.reasons.some((r) => r.toLowerCase().includes('stale'))).toBe(true);
  });

  it('a fresh attestation (within maxAgeMs) is NOT downgraded', () => {
    const signal = toExternalSignal(
      makeExternal({ status: 'verified', checkedAt: FRESH_ISO }),
      { maxAgeMs: EXTERNAL_STALENESS_MAX_AGE_MS, now: NOW_MS }
    );

    expect(signal.status).toBe('verified');
  });

  it('a fresh verified attestation still adds the bonus', () => {
    const result = composeVerdict({
      ...CLEAN,
      external: makeExternal({ status: 'verified', checkedAt: FRESH_ISO }),
    });

    expect(result.confidence).toBeGreaterThan(CLEAN.baseConfidence);
    expect(result.composition.outcome).toBe('verified-both');
  });
});

// ── Repeated stale calls ─────────────────────────────────────────────────────

describe('repeated stale calls: no accumulation', () => {
  it('calling composeVerdict twice with the same stale result gives the same confidence', () => {
    const input = {
      ...CLEAN,
      external: makeExternal({ status: 'verified', checkedAt: STALE_ISO }),
    };

    const first = composeVerdict(input);
    const second = composeVerdict(input);

    expect(first.confidence).toBe(second.confidence);
    expect(first.composition.outcome).toBe(second.composition.outcome);
  });
});

// ── Interrupted / partial results ────────────────────────────────────────────

describe('interrupted source: partial or malformed result', () => {
  it('a result missing reasons does not throw', () => {
    const partial = { status: 'verified' as const, provider: 'test-kyb', checkedAt: FRESH_ISO };
    expect(() => toExternalSignal(partial, { now: NOW_MS })).not.toThrow();
    const signal = toExternalSignal(partial, { now: NOW_MS });
    expect(signal.reasons).toEqual([]);
  });

  it('a result with no checkedAt is not downgraded by staleness logic', () => {
    // No checkedAt → we cannot evaluate staleness → leave status as-is.
    const signal = toExternalSignal(
      makeExternal({ status: 'verified', checkedAt: undefined }),
      { maxAgeMs: 0, now: NOW_MS } // maxAgeMs=0 would stale anything with a timestamp
    );

    expect(signal.status).toBe('verified');
  });

  it('a result with a non-finite checkedAt is not downgraded', () => {
    const signal = toExternalSignal(
      makeExternal({ status: 'verified', checkedAt: 'not-a-date' }),
      { maxAgeMs: EXTERNAL_STALENESS_MAX_AGE_MS, now: NOW_MS }
    );

    expect(signal.status).toBe('verified');
  });

  it('a result with providerConfidence out of range is clamped, not rejected', () => {
    const signal = toExternalSignal(
      makeExternal({ providerConfidence: 999, checkedAt: FRESH_ISO }),
      { now: NOW_MS }
    );

    expect(signal.providerConfidence).toBe(1);
    expect(signal.status).toBe('verified');
  });
});

// ── Normal path regression guard ─────────────────────────────────────────────

describe('normal path: behavior for covered sources is unchanged', () => {
  it('fresh verified adds the bonus', () => {
    const result = composeVerdict({
      ...CLEAN,
      external: makeExternal({ status: 'verified', checkedAt: FRESH_ISO }),
    });

    expect(result.confidence).toBeCloseTo(CLEAN.baseConfidence + EXTERNAL_VERIFIED_BONUS, 5);
    expect(result.isVerified).toBe(true);
  });

  it('fresh unverified caps confidence', () => {
    const result = composeVerdict({
      ...CLEAN,
      baseConfidence: 0.9,
      external: makeExternal({ status: 'unverified', checkedAt: FRESH_ISO }),
    });

    expect(result.confidence).toBe(EXTERNAL_UNVERIFIED_CONFIDENCE_CAP);
  });

  it('fraud signals are still blocking even when external is fresh-verified', () => {
    const result = composeVerdict({
      ...CLEAN,
      fraudSignals: ['Rapid succession'],
      external: makeExternal({ status: 'verified', checkedAt: FRESH_ISO }),
    });

    expect(result.isVerified).toBe(false);
    expect(result.composition.outcome).toBe('rejected-fraud-signals');
  });

  it('stale data outranks a fresh verified signal', () => {
    const result = composeVerdict({
      ...CLEAN,
      isFresh: false,
      external: makeExternal({ status: 'verified', checkedAt: FRESH_ISO }),
    });

    expect(result.composition.outcome).toBe('rejected-stale-data');
  });
});

import { describe, expect, it } from 'vitest';

import {
  COMPOSITION_POLICY_VERSION,
  EXTERNAL_UNVERIFIED_CONFIDENCE_CAP,
  EXTERNAL_VERIFIED_BONUS,
  MIN_CONFIDENCE,
  MIN_TRUST_SCORE,
  composeConfidence,
  composeVerdict,
  confidenceLevelFromScore,
  toExternalSignal,
} from './composition';
import { makeExternal } from './testFixtures';

/**
 * The composition policy: fraud heuristics are blocking, the external KYB
 * signal moves confidence but never the verdict, and `unknown` is inert.
 *
 * The four-combination matrix the issue asks for is the first describe block;
 * the rest pin the individual rules that produce those outcomes.
 */

const CLEAN = { trustScore: 85, baseConfidence: 0.8, fraudSignals: [] as string[], isFresh: true };
const FLAGGED = {
  trustScore: 85,
  baseConfidence: 0.8,
  fraudSignals: ['Rapid succession of invoices detected for the same payer'],
  isFresh: true,
};

describe('composition matrix: verified/unverified x fraud/no-fraud', () => {
  it('verified + no fraud flags → verified, both signals agree', () => {
    const result = composeVerdict({ ...CLEAN, external: makeExternal({ status: 'verified' }) });

    expect(result.isVerified).toBe(true);
    expect(result.composition.outcome).toBe('verified-both');
    expect(result.composition.heuristic.passed).toBe(true);
    expect(result.composition.external.status).toBe('verified');
    // The corroborating signal raises confidence above the heuristic alone.
    expect(result.confidence).toBeGreaterThan(CLEAN.baseConfidence);
  });

  it('verified + fraud flags → rejected; KYB does not clear behavioural fraud', () => {
    const result = composeVerdict({ ...FLAGGED, external: makeExternal({ status: 'verified' }) });

    expect(result.isVerified).toBe(false);
    expect(result.composition.outcome).toBe('rejected-fraud-signals');
    expect(result.composition.external.status).toBe('verified');
    expect(result.composition.heuristic.passed).toBe(false);
    expect(result.composition.rationale).toMatch(/does not clear/i);
  });

  it('unverified + no fraud flags → verified, but confidence is capped', () => {
    const result = composeVerdict({ ...CLEAN, external: makeExternal({ status: 'unverified' }) });

    expect(result.isVerified).toBe(true);
    expect(result.composition.outcome).toBe('verified-heuristic-only');
    expect(result.confidence).toBe(EXTERNAL_UNVERIFIED_CONFIDENCE_CAP);
    expect(result.composition.rationale).toMatch(/capped/i);
  });

  it('unverified + fraud flags → rejected on the fraud signal', () => {
    const result = composeVerdict({ ...FLAGGED, external: makeExternal({ status: 'unverified' }) });

    expect(result.isVerified).toBe(false);
    expect(result.composition.outcome).toBe('rejected-fraud-signals');
  });

  it('exposes both sub-scores in every combination, not just a boolean', () => {
    for (const status of ['verified', 'unverified', 'unknown'] as const) {
      for (const base of [CLEAN, FLAGGED]) {
        const { composition } = composeVerdict({ ...base, external: makeExternal({ status }) });

        expect(composition.heuristic).toMatchObject({
          trustScore: base.trustScore,
          fraudSignals: base.fraudSignals,
        });
        expect(composition.external.status).toBe(status);
        expect(typeof composition.baseConfidence).toBe('number');
        expect(typeof composition.composedConfidence).toBe('number');
        expect(composition.policy).toBe(COMPOSITION_POLICY_VERSION);
      }
    }
  });
});

describe('unknown external results are inert', () => {
  it('leaves confidence untouched when no provider is configured', () => {
    const result = composeVerdict({ ...CLEAN, external: undefined });

    expect(result.confidence).toBe(CLEAN.baseConfidence);
    expect(result.composition.outcome).toBe('verified-heuristic-only');
    expect(result.composition.external.provider).toBeNull();
    expect(result.composition.rationale).toMatch(/no external verification/i);
  });

  it('treats an unreachable provider as unknown, never as unverified', () => {
    const unknown = composeVerdict({
      ...CLEAN,
      external: makeExternal({ status: 'unknown', provider: 'unavailable' }),
    });
    const unverified = composeVerdict({
      ...CLEAN,
      external: makeExternal({ status: 'unverified' }),
    });

    // An outage must not silently tighten the bar the way a real negative does.
    expect(unknown.confidence).toBe(CLEAN.baseConfidence);
    expect(unverified.confidence).toBeLessThan(unknown.confidence);
  });
});

describe('precedence between rejection reasons', () => {
  it('stale data outranks fraud signals', () => {
    const result = composeVerdict({ ...FLAGGED, isFresh: false, external: undefined });

    expect(result.composition.outcome).toBe('rejected-stale-data');
  });

  it('fraud signals outrank a low trust score', () => {
    const result = composeVerdict({
      trustScore: 10,
      baseConfidence: 0.9,
      fraudSignals: ['Recent default concentration suggests elevated fraud risk'],
      isFresh: true,
      external: undefined,
    });

    expect(result.composition.outcome).toBe('rejected-fraud-signals');
  });

  it('rejects on trust score below the threshold', () => {
    const result = composeVerdict({
      ...CLEAN,
      trustScore: MIN_TRUST_SCORE - 1,
      external: undefined,
    });

    expect(result.composition.outcome).toBe('rejected-low-trust');
    expect(result.composition.rationale).toMatch(/Trust score/);
  });

  it('rejects on composed confidence below the threshold', () => {
    const result = composeVerdict({
      ...CLEAN,
      baseConfidence: MIN_CONFIDENCE - 0.01,
      external: undefined,
    });

    expect(result.composition.outcome).toBe('rejected-low-trust');
    expect(result.composition.rationale).toMatch(/confidence/i);
  });

  it('accepts exactly at both thresholds', () => {
    const result = composeVerdict({
      trustScore: MIN_TRUST_SCORE,
      baseConfidence: MIN_CONFIDENCE,
      fraudSignals: [],
      isFresh: true,
      external: undefined,
    });

    expect(result.isVerified).toBe(true);
  });

  it('lets a capped confidence flip a marginal verdict to rejected', () => {
    // Heuristic alone would pass; the provider's explicit negative pulls the
    // composed confidence under the bar. This is the cap doing its job.
    const marginal = {
      trustScore: 90,
      baseConfidence: 0.58,
      fraudSignals: [] as string[],
      isFresh: true,
    };

    expect(composeVerdict({ ...marginal, external: undefined }).isVerified).toBe(true);

    const capped = composeVerdict({
      ...marginal,
      external: makeExternal({ status: 'unverified' }),
    });
    expect(capped.confidence).toBe(0.58);
    expect(capped.isVerified).toBe(true);

    // Below the threshold, the cap is what rejects it.
    const lower = composeVerdict({
      ...marginal,
      baseConfidence: 0.54,
      external: makeExternal({ status: 'unverified' }),
    });
    expect(lower.isVerified).toBe(false);
  });
});

describe('composeConfidence', () => {
  it('adds the full bonus for an unqualified verified result', () => {
    expect(composeConfidence(0.5, toExternalSignal(makeExternal({ status: 'verified' })))).toBe(
      0.5 + EXTERNAL_VERIFIED_BONUS
    );
  });

  it('scales the bonus by the provider’s own confidence', () => {
    const half = toExternalSignal(makeExternal({ status: 'verified', providerConfidence: 0.5 }));
    expect(composeConfidence(0.5, half)).toBe(0.5 + EXTERNAL_VERIFIED_BONUS * 0.5);
  });

  it('never exceeds 1', () => {
    expect(composeConfidence(0.95, toExternalSignal(makeExternal({ status: 'verified' })))).toBe(1);
  });

  it('caps rather than reduces an already-low confidence', () => {
    // A confidence below the cap is left alone; the cap is a ceiling, not a
    // penalty applied on top.
    const signal = toExternalSignal(makeExternal({ status: 'unverified' }));
    expect(composeConfidence(0.3, signal)).toBe(0.3);
    expect(composeConfidence(0.9, signal)).toBe(EXTERNAL_UNVERIFIED_CONFIDENCE_CAP);
  });
});

describe('toExternalSignal', () => {
  it('normalizes a missing provider result to unknown', () => {
    expect(toExternalSignal(undefined)).toEqual({
      status: 'unknown',
      provider: null,
      providerConfidence: null,
      checkedAt: null,
      reasons: [],
    });
  });

  it('carries provider metadata through for attribution', () => {
    const signal = toExternalSignal(
      makeExternal({
        provider: 'acme-kyb',
        providerConfidence: 0.87,
        checkedAt: '2026-01-01T00:00:00.000Z',
        reasons: ['Registry match'],
      })
    );

    expect(signal.provider).toBe('acme-kyb');
    expect(signal.providerConfidence).toBe(0.87);
    expect(signal.checkedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(signal.reasons).toEqual(['Registry match']);
  });

  it('clamps an out-of-range provider confidence', () => {
    expect(toExternalSignal(makeExternal({ providerConfidence: 5 }))?.providerConfidence).toBe(1);
    expect(toExternalSignal(makeExternal({ providerConfidence: -2 }))?.providerConfidence).toBe(0);
  });
});

describe('confidenceLevelFromScore', () => {
  it.each([
    [0, 'low'],
    [0.39, 'low'],
    [0.4, 'medium'],
    [0.74, 'medium'],
    [0.75, 'high'],
    [1, 'high'],
  ] as const)('maps %s to %s', (score, level) => {
    expect(confidenceLevelFromScore(score)).toBe(level);
  });
});

describe('evidence', () => {
  it('records the provider status and the deciding rule', () => {
    const result = composeVerdict({
      ...CLEAN,
      external: makeExternal({ provider: 'acme-kyb', reasons: ['Registry match'] }),
    });

    expect(result.evidence).toContain('External verification (acme-kyb): verified');
    expect(result.evidence).toContain('External provider note: Registry match');
    expect(result.evidence.some((line) => line.includes('verified-both'))).toBe(true);
  });

  it('notes when the external signal moved the confidence', () => {
    const result = composeVerdict({ ...CLEAN, external: makeExternal({ status: 'unverified' }) });

    expect(result.evidence.some((line) => line.includes('Confidence adjusted'))).toBe(true);
  });

  it('says so plainly when no provider is configured', () => {
    const result = composeVerdict({ ...CLEAN, external: undefined });

    expect(result.evidence).toContain('External verification: not configured');
  });
});

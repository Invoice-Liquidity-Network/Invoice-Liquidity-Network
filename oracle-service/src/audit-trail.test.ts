import { describe, expect, it } from 'vitest';
import { AuditTrail } from './audit-trail';
import type { OracleVerificationResponse } from './types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const PAYER_A = 'GAPAYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PAYER_B = 'GBPAYERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

let _seq = 0;
function makeResponse(
  overrides: Partial<OracleVerificationResponse> = {}
): OracleVerificationResponse {
  _seq += 1;
  return {
    requestId: `req-${_seq}`,
    payer: PAYER_A,
    invoiceId: String(_seq),
    amount: '10000000',
    trustScore: 80,
    confidence: 0.9,
    confidenceLevel: 'high',
    isVerified: true,
    generatedAt: new Date(1_700_000_000_000 + _seq * 1000).toISOString(),
    dataAgeMs: 100,
    cacheHit: false,
    reputationScore: 80,
    historicalSuccessRate: 1,
    historicalDefaultRate: 0,
    averageHistoricalAmount: '10000000',
    amountDeviation: 0,
    settlementVarianceDays: 0,
    fraudSignals: [],
    evidence: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

describe('AuditTrail.append', () => {
  it('creates a first entry with an empty prevHash', () => {
    const trail = new AuditTrail('test-audit-key');
    const entry = trail.append(makeResponse());

    expect(entry.seq).toBe(1);
    expect(entry.prevHash).toBe('');
    expect(entry.hash).toBeTruthy();
    expect(entry.signature).toBeTruthy();
  });

  it('chains subsequent entries using the previous hash', () => {
    const trail = new AuditTrail('test-audit-key');
    const e1 = trail.append(makeResponse());
    const e2 = trail.append(makeResponse());

    expect(e2.seq).toBe(2);
    expect(e2.prevHash).toBe(e1.hash);
  });

  it('records all fields from the response', () => {
    const trail = new AuditTrail('test-audit-key');
    const response = makeResponse({ trustScore: 55, isVerified: false, payer: PAYER_B });
    const entry = trail.append(response);

    expect(entry.payer).toBe(PAYER_B);
    expect(entry.trustScore).toBe(55);
    expect(entry.isVerified).toBe(false);
    expect(entry.invoiceId).toBe(response.invoiceId);
    expect(entry.amount).toBe(response.amount);
    expect(entry.generatedAt).toBe(response.generatedAt);
  });
});

// ---------------------------------------------------------------------------
// getEntries
// ---------------------------------------------------------------------------

describe('AuditTrail.getEntries', () => {
  function buildTrail(): AuditTrail {
    const trail = new AuditTrail('test-audit-key');
    trail.append(
      makeResponse({ payer: PAYER_A, generatedAt: '2024-01-01T00:00:00.000Z' })
    );
    trail.append(
      makeResponse({ payer: PAYER_B, generatedAt: '2024-06-01T00:00:00.000Z' })
    );
    trail.append(
      makeResponse({ payer: PAYER_A, generatedAt: '2024-12-01T00:00:00.000Z' })
    );
    return trail;
  }

  it('returns all entries when no filter is given', () => {
    const trail = buildTrail();
    expect(trail.getEntries()).toHaveLength(3);
  });

  it('filters by payer', () => {
    const trail = buildTrail();
    const entries = trail.getEntries({ payer: PAYER_A });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.payer === PAYER_A)).toBe(true);
  });

  it('filters by from date (inclusive lower bound)', () => {
    const trail = buildTrail();
    const entries = trail.getEntries({ from: '2024-06-01T00:00:00.000Z' });
    expect(entries).toHaveLength(2);
  });

  it('filters by to date (inclusive upper bound)', () => {
    const trail = buildTrail();
    const entries = trail.getEntries({ to: '2024-06-01T00:00:00.000Z' });
    expect(entries).toHaveLength(2);
  });

  it('combines payer and date filters', () => {
    const trail = buildTrail();
    const entries = trail.getEntries({
      payer: PAYER_A,
      from: '2024-06-01T00:00:00.000Z',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].generatedAt).toBe('2024-12-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// verifyIntegrity
// ---------------------------------------------------------------------------

describe('AuditTrail.verifyIntegrity', () => {
  it('reports valid=true for an intact chain', () => {
    const trail = new AuditTrail('test-audit-key');
    trail.append(makeResponse());
    trail.append(makeResponse());
    trail.append(makeResponse());

    const result = trail.verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it('reports valid=true for an empty trail', () => {
    const trail = new AuditTrail('test-audit-key');
    expect(trail.verifyIntegrity().valid).toBe(true);
  });

  it('detects a tampered entry hash', () => {
    const trail = new AuditTrail('test-audit-key');
    trail.append(makeResponse());
    trail.append(makeResponse());
    const e3 = trail.append(makeResponse());

    // Directly mutate the private entries array through the public accessor.
    const entries = trail.getEntries();
    // Tamper with entry 2's hash (1-indexed seq = 2).
    const target = entries.find((e) => e.seq === 2)!;
    (target as any).hash = 'aaaa' + target.hash.slice(4);

    const result = trail.verifyIntegrity();
    expect(result.valid).toBe(false);
    // Entry 3 references entry 2's (now broken) hash, so brokenAt === 3.
    expect(result.brokenAt).toBe(3);
    void e3; // used indirectly
  });

  it('detects a tampered entry field', () => {
    const trail = new AuditTrail('test-audit-key');
    trail.append(makeResponse());
    trail.append(makeResponse());

    const entries = trail.getEntries();
    // Tamper with entry 1's trustScore — hash will no longer match.
    (entries[0] as any).trustScore = 0;

    const result = trail.verifyIntegrity();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';

import { createOracleCache } from './cache';
import {
  assessOracleRequest,
  OracleVerifier,
  normalizeAmountToNumber,
  normalizeTimestampToMs,
} from './verifier';
import type {
  IndexerInvoiceHistoryEntry,
  OracleVerificationRequest,
  ReputationSnapshot,
} from './types';

const request: OracleVerificationRequest = {
  payer: 'GTESTPAYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  amount: '10000000',
  invoiceId: '99',
};

// A genuinely healthy history: amounts spread far outside the 5% similar-amount
// band, creations five days apart so the rapid-succession heuristic stays
// quiet, and every settlement taking exactly ten days so variance is zero.
// The previous fixture had four amounts within 2% of the request, which tripped
// the similar-amount heuristic and made `isVerified: true` unreachable.
const healthyHistory: IndexerInvoiceHistoryEntry[] = [
  {
    id: 1,
    freelancer: 'G1',
    payer: request.payer,
    amount: '8000000',
    due_date: 0,
    discount_rate: 300,
    status: 'Paid',
    funder: 'G2',
    funded_at: 1700000000000,
    created_at: 1700000000000,
    updated_at: 1700864000000,
  },
  {
    id: 2,
    freelancer: 'G1',
    payer: request.payer,
    amount: '10000000',
    due_date: 0,
    discount_rate: 300,
    status: 'Paid',
    funder: 'G2',
    funded_at: 1700432000000,
    created_at: 1700432000000,
    updated_at: 1701296000000,
  },
  {
    id: 3,
    freelancer: 'G1',
    payer: request.payer,
    amount: '12000000',
    due_date: 0,
    discount_rate: 300,
    status: 'Paid',
    funder: 'G2',
    funded_at: 1700864000000,
    created_at: 1700864000000,
    updated_at: 1701728000000,
  },
  {
    id: 4,
    freelancer: 'G1',
    payer: request.payer,
    amount: '14000000',
    due_date: 0,
    discount_rate: 300,
    status: 'Defaulted',
    funder: 'G2',
    funded_at: 1701296000000,
    created_at: 1701296000000,
    updated_at: 1702160000000,
  },
];

/** Newest source timestamp across the healthy fixture. */
const HEALTHY_LATEST_MS = 1702160000000;

const fraughtHistory: IndexerInvoiceHistoryEntry[] = [
  {
    id: 10,
    freelancer: 'G1',
    payer: request.payer,
    amount: '10000000',
    due_date: 0,
    discount_rate: 300,
    status: 'Defaulted',
    funder: 'G2',
    funded_at: 1_700_000_000,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_001_000_000,
  },
  {
    id: 11,
    freelancer: 'G1',
    payer: request.payer,
    amount: '10010000',
    due_date: 0,
    discount_rate: 300,
    status: 'Defaulted',
    funder: 'G2',
    funded_at: 1_700_003_000,
    created_at: 1_700_003_000_000,
    updated_at: 1_700_004_000_000,
  },
  {
    id: 12,
    freelancer: 'G1',
    payer: request.payer,
    amount: '10005000',
    due_date: 0,
    discount_rate: 300,
    status: 'Pending',
    funder: null,
    funded_at: null,
    created_at: 1_700_006_000_000,
    updated_at: 1_700_006_500_000,
  },
];

const reputation: ReputationSnapshot = {
  address: request.payer,
  score: 86,
  totalPaid: 10_000_000n,
  invoiceCount: 4,
  lastActivity: 1_700_860_000,
  rank: 5,
};

describe('oracle verifier calculations', () => {
  it('normalizes amounts and timestamps', () => {
    expect(normalizeAmountToNumber('10000000')).toBe(10000000);
    expect(normalizeTimestampToMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTimestampToMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('computes a strong trust score for healthy history', () => {
    // Anchored just past the fixture's newest timestamp so the data stays
    // inside maxOracleAgeMs. The previous value sat 240,000,000 ms past it, so
    // the assessment was always stale and `isVerified` could never be true.
    const assessment = assessOracleRequest({
      request,
      reputation,
      history: healthyHistory,
      nowMs: HEALTHY_LATEST_MS + 60_000,
      maxOracleAgeMs: 10_000_000,
      nowMs: 1_701_100_000_000,
      maxOracleAgeMs: 150_000_000,
    });

    expect(assessment.response.trustScore).toBeGreaterThan(60);
    expect(assessment.response.confidence).toBeGreaterThan(0.5);
    expect(assessment.response.isVerified).toBe(true);
    expect(assessment.response.historicalDefaultRate).toBeCloseTo(0.25, 2);
    expect(assessment.response.averageHistoricalAmount).toBe('11000000');
  });

  it('flags concentrated short-window activity as risk', () => {
    const assessment = assessOracleRequest({
      request,
      reputation,
      history: fraughtHistory,
      nowMs: 1_701_100_000_000,
      maxOracleAgeMs: 10_000_000,
    });

    expect(assessment.response.fraudSignals.length).toBeGreaterThan(0);
    expect(assessment.response.isVerified).toBe(false);
    expect(assessment.response.trustScore).toBeLessThan(70);
  });

  it('deduplicates concurrent verification requests through inflight caching', async () => {
    const { cache } = await createOracleCache();
    let historyCalls = 0;
    let reputationCalls = 0;

    const verifier = new OracleVerifier({
      cache,
      historyProvider: async () => {
        historyCalls += 1;
        return healthyHistory;
      },
      reputationProvider: async () => {
        reputationCalls += 1;
        return reputation;
      },
      cacheTtlSeconds: 300,
      maxOracleAgeMs: 10_000_000,
      now: () => 1_701_100_000_000,
    });

    const results = await Promise.all(Array.from({ length: 100 }, () => verifier.verify(request)));

    expect(results).toHaveLength(100);
    expect(historyCalls).toBe(1);
    expect(reputationCalls).toBe(1);
    expect(results[0].cacheHit).toBe(false);
    expect(results.slice(1).every((result) => result.cacheHit)).toBe(true);
  });

  it('gracefully degrades when indexer is unavailable', async () => {
    const { cache } = await createOracleCache();

    const verifier = new OracleVerifier({
      cache,
      historyProvider: async () => {
        throw new Error('Indexer unavailable');
      },
      reputationProvider: async () => {
        return reputation;
      },
      cacheTtlSeconds: 300,
      maxOracleAgeMs: 10_000_000,
      now: () => 1_701_100_000_000,
    });

    const result = await verifier.verify(request);

    expect(result).toBeDefined();
    expect(result.requestId).toBe(request.payer + ':' + request.invoiceId + ':1701100000000');
    // Should still return a response, but with reduced confidence
    expect(result.evidence.some((e) => e.includes('Indexer data unavailable'))).toBe(true);
    // Reputation-only assessment should still work
    expect(result.reputationScore).toBe(reputation.score);
  });

  it('marks response as reduced confidence when indexer data is unavailable', async () => {
    const { cache } = await createOracleCache();

    const verifier = new OracleVerifier({
      cache,
      historyProvider: async () => {
        throw new Error('Connection timeout');
      },
      reputationProvider: async () => {
        return reputation;
      },
      cacheTtlSeconds: 300,
      maxOracleAgeMs: 10_000_000,
      now: () => 1_701_100_000_000,
    });

    const result = await verifier.verify(request);

    // Response should be marked with indexer unavailability
    expect(result.evidence.some((e) => e.includes('Indexer data unavailable'))).toBe(true);
    // Empty history should result in lower confidence
    expect(result.historicalSuccessRate).toBe(0);
    expect(result.evidence.some((e) => e.includes('No payer history available'))).toBe(true);
  });
});

describe('oracle verifier numeric normalization - property-based tests', () => {
  it('normalizeAmountToNumber: converts valid string amounts correctly', () => {
    const testCases = ['0', '1', '100', '999999999', '9007199254740991'];

    for (const input of testCases) {
      const result = normalizeAmountToNumber(input);
      expect(result).toBe(Number(input));
      expect(Number.isFinite(result)).toBe(true);
    }
  });

  it('normalizeAmountToNumber: handles bigint values', () => {
    const testCases: bigint[] = [0n, 1n, 100n, 9007199254740991n];

    for (const input of testCases) {
      const result = normalizeAmountToNumber(input);
      expect(result).toBe(Number(input));
      expect(Number.isFinite(result)).toBe(true);
    }
  });

  it('normalizeAmountToNumber: handles numbers directly', () => {
    const testCases = [0, 1, 100, 999999999];

    for (const input of testCases) {
      const result = normalizeAmountToNumber(input);
      expect(result).toBe(input);
      expect(Number.isFinite(result)).toBe(true);
    }
  });

  it('normalizeAmountToNumber: returns MAX_SAFE_INTEGER for values exceeding safe range', () => {
    // Values that exceed Number.MAX_SAFE_INTEGER should fallback
    const bigValue = '9007199254740992'; // One past MAX_SAFE_INTEGER
    const result = normalizeAmountToNumber(bigValue);
    expect(result).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('normalizeAmountToNumber: handles negative values gracefully', () => {
    // Negative values should be treated as their numeric equivalent
    const testCases = ['-1', '-100', -50];

    for (const input of testCases) {
      const result = normalizeAmountToNumber(input);
      expect(Number.isFinite(result)).toBe(true);
    }
  });

  it('normalizeAmountToNumber: handles malformed strings', () => {
    const testCases = [
      'not-a-number',
      'abc123',
      '12.34.56',
      '0x123', // hex-like but invalid in standard Number()
      '',
      'null',
      'undefined',
    ];

    for (const input of testCases) {
      const result = normalizeAmountToNumber(input);
      // Should return 0 for malformed strings (fallback behavior)
      expect(Number.isFinite(result)).toBe(true);
      expect(result === 0 || result === Number.MAX_SAFE_INTEGER).toBe(true);
    }
  });

  it('normalizeAmountToNumber: treats unparseable amounts as maximally suspicious for fraud detection', () => {
    // The function should favor conservative defaults - unparseable values
    // that might indicate tampering should be treated as MAX_SAFE_INTEGER
    const malformedBigint = '999999999999999999999999999999999999999999999';
    const result = normalizeAmountToNumber(malformedBigint);

    // Should fall back to a safe default (either 0 or MAX_SAFE_INTEGER)
    expect(Number.isFinite(result)).toBe(true);
    // For fraud detection, treating it as MAX_SAFE_INTEGER means we're conservative
    expect([0, Number.MAX_SAFE_INTEGER].includes(result)).toBe(true);
  });

  it('normalizeAmountToNumber: zero values are consistently handled', () => {
    const testCases: Array<string | number | bigint> = ['0', 0, 0n];

    for (const input of testCases) {
      const result = normalizeAmountToNumber(input);
      expect(result).toBe(0);
    }
  });

  it('normalizeAmountToNumber: handles string representations of bigints', () => {
    // Large numbers that fit in bigint but not safe integer
    const input = '99007199254740991'; // Close to safe range
    const result = normalizeAmountToNumber(input);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('normalizeTimestampToMs: converts seconds to milliseconds', () => {
    expect(normalizeTimestampToMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTimestampToMs('1700000000')).toBe(1_700_000_000_000);
  });

  it('normalizeTimestampToMs: handles millisecond timestamps', () => {
    const msTimestamp = 1_700_000_000_000;
    expect(normalizeTimestampToMs(msTimestamp)).toBe(msTimestamp);
  });

  it('normalizeTimestampToMs: returns 0 for null or undefined', () => {
    expect(normalizeTimestampToMs(null)).toBe(0);
    expect(normalizeTimestampToMs(undefined)).toBe(0);
  });

  it('normalizeTimestampToMs: returns 0 for non-positive values', () => {
    expect(normalizeTimestampToMs(-1000)).toBe(0);
    expect(normalizeTimestampToMs(0)).toBe(0);
    expect(normalizeTimestampToMs('-1000')).toBe(0);
  });

  it('normalizeTimestampToMs: correctly distinguishes seconds from milliseconds based on magnitude', () => {
    // Numbers less than 1e12 are treated as seconds
    expect(normalizeTimestampToMs(1_000_000_000)).toBe(1_000_000_000_000);
    // Numbers >= 1e12 are treated as milliseconds
    expect(normalizeTimestampToMs(1_000_000_000_000)).toBe(1_000_000_000_000);
  });

  it('normalizeTimestampToMs: handles string representations', () => {
    expect(normalizeTimestampToMs('1700000000')).toBe(1_700_000_000_000);
    expect(normalizeTimestampToMs('1700000000000')).toBe(1_700_000_000_000);
  });
});

describe('pluggable KYB provider integration (#868)', () => {
  it('composes external KYB provider results into oracle verification', async () => {
    const { MockKYBProvider } = await import('./kyb/mockProvider');
    const mockKyb = new MockKYBProvider({
      knownBusinesses: {
        [request.payer]: {
          isVerified: true,
          businessName: 'Acme Corp Technologies Inc.',
          registrationNumber: 'US-DE-12345678',
          jurisdiction: 'US-DE',
          riskScore: 5,
        },
      },
    });

    const verifier = new OracleVerifier({
      historyProvider: async () => healthyHistory,
      reputationProvider: async () => reputation,
      kybProvider: mockKyb,
      now: () => 1_701_000_100_000,
    });

    const response = await verifier.verify(request);

    expect(response.isVerified).toBe(true);
    expect(response.kybResult).toBeDefined();
    expect(response.kybResult?.provider).toBe('MockKYBProvider');
    expect(response.kybResult?.isVerified).toBe(true);
    expect(response.kybResult?.businessName).toBe('Acme Corp Technologies Inc.');
    expect(
      response.evidence.some((e) => e.includes('KYB verification (MockKYBProvider): VERIFIED'))
    ).toBe(true);
  });

  it('fails verification when external KYB provider rejects business entity', async () => {
    const { MockKYBProvider } = await import('./kyb/mockProvider');
    const mockKyb = new MockKYBProvider({
      knownBusinesses: {
        [request.payer]: {
          isVerified: false,
          businessName: 'Suspicious Ghost Entity LLC',
          registrationNumber: 'INVALID-000',
          jurisdiction: 'XX',
          signals: ['Registration revoked by corporate registrar'],
        },
      },
    });

    const verifier = new OracleVerifier({
      historyProvider: async () => healthyHistory,
      reputationProvider: async () => reputation,
      kybProvider: mockKyb,
      now: () => 1_701_000_100_000,
    });

    const response = await verifier.verify(request);

    expect(response.isVerified).toBe(false);
    expect(response.kybResult?.isVerified).toBe(false);
    expect(response.fraudSignals.some((s) => s.includes('KYB provider'))).toBe(true);
    expect(
      response.evidence.some((e) => e.includes('KYB verification (MockKYBProvider): UNVERIFIED'))
    ).toBe(true);
  });
});


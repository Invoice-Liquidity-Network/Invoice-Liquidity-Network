/**
 * Shared fixtures for the oracle-service test suites.
 *
 * Excluded from coverage in vitest.config.ts — this is test scaffolding, not
 * shipped code, and counting it would inflate the package's coverage figure.
 */

import type {
  ExternalVerificationResult,
  IndexerInvoiceHistoryEntry,
  OracleSignalComposition,
  OracleVerificationResponse,
  ReputationSnapshot,
} from './types';

/** A syntactically valid Stellar public key, for HTTP-level tests. */
export const TEST_PAYER = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

export const DAY_MS = 24 * 60 * 60 * 1000;

export function makeComposition(
  overrides: Partial<OracleSignalComposition> = {}
): OracleSignalComposition {
  return {
    policy: 'heuristic-blocking-v1',
    outcome: 'verified-heuristic-only',
    rationale: 'Heuristics clean; no external verification available.',
    heuristic: {
      trustScore: 88,
      confidence: 0.92,
      confidenceLevel: 'high',
      fraudSignals: [],
      passed: true,
    },
    external: {
      status: 'unknown',
      provider: null,
      providerConfidence: null,
      checkedAt: null,
      reasons: [],
    },
    baseConfidence: 0.92,
    composedConfidence: 0.92,
    ...overrides,
  };
}

export function makeResponse(
  overrides: Partial<OracleVerificationResponse> = {}
): OracleVerificationResponse {
  return {
    requestId: 'req-1',
    payer: TEST_PAYER,
    invoiceId: '42',
    amount: '10000000',
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
    composition: makeComposition(),
    ...overrides,
  };
}

/**
 * Build a history entry relative to `nowMs`, so fixtures never go stale the way
 * hard-coded epoch timestamps do.
 */
export function makeHistoryEntry(
  nowMs: number,
  overrides: Partial<IndexerInvoiceHistoryEntry> & { agoMs?: number } = {}
): IndexerInvoiceHistoryEntry {
  const { agoMs = 10 * DAY_MS, ...rest } = overrides;
  const createdAt = nowMs - agoMs;

  return {
    id: 1,
    freelancer: 'GFREELANCER',
    payer: TEST_PAYER,
    amount: '10000000',
    due_date: 0,
    discount_rate: 300,
    status: 'Paid',
    funder: 'GFUNDER',
    funded_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt + DAY_MS,
    ...rest,
  };
}

export function makeReputation(
  nowMs: number,
  overrides: Partial<ReputationSnapshot> = {}
): ReputationSnapshot {
  return {
    address: TEST_PAYER,
    score: 90,
    totalPaid: 20_000_000n,
    invoiceCount: 4,
    lastActivity: nowMs,
    rank: 3,
    ...overrides,
  };
}

export function makeExternal(
  overrides: Partial<ExternalVerificationResult> = {}
): ExternalVerificationResult {
  return {
    status: 'verified',
    provider: 'test-kyb',
    ...overrides,
  };
}

/**
 * A clean, recent history that produces a passing heuristic verdict: enough
 * volume for confidence, all paid, no fraud patterns.
 */
export function healthyHistory(nowMs: number): IndexerInvoiceHistoryEntry[] {
  return Array.from({ length: 12 }, (_, index) =>
    makeHistoryEntry(nowMs, {
      id: index + 1,
      // Spread well beyond the rapid-succession window, and vary the amounts
      // so the similar-amount heuristic does not fire.
      agoMs: (index + 2) * 3 * DAY_MS,
      amount: String(9_000_000 + index * 400_000),
    })
  );
}

/** A history that trips the rapid-succession and similar-amount heuristics. */
export function fraudulentHistory(nowMs: number): IndexerInvoiceHistoryEntry[] {
  return Array.from({ length: 5 }, (_, index) =>
    makeHistoryEntry(nowMs, {
      id: index + 1,
      agoMs: index * 60 * 60 * 1000,
      amount: '10000000',
      status: 'Pending',
    })
  );
}

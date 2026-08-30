export type InvoiceStatus = 'Pending' | 'Funded' | 'Paid' | 'Defaulted';

export interface IndexerInvoiceHistoryEntry {
  id: number;
  freelancer: string;
  payer: string;
  amount: string;
  due_date: number;
  discount_rate: number;
  status: InvoiceStatus;
  funder?: string | null;
  funded_at?: number | null;
  created_at: number;
  updated_at: number;
}

export interface ReputationSnapshot {
  address: string;
  score: number;
  totalPaid: bigint;
  invoiceCount: number;
  lastActivity: number;
  rank: number;
}

export interface OracleVerificationRequest {
  payer: string;
  amount: string | number | bigint;
  invoiceId: string | number | bigint;
  forceRefresh?: boolean;
  requestId?: string;
  maxOracleAgeMs?: number;
}

export interface KYBVerificationResult {
  provider: string;
  isVerified: boolean;
  businessName?: string;
  registrationNumber?: string;
  jurisdiction?: string;
  riskScore?: number;
  verifiedAt?: string;
  signals?: string[];
  rawDetails?: Record<string, unknown>;
}

export interface VerificationProvider {
  name: string;
  verifyPayer(
    payerAddress: string,
    metadata?: Record<string, unknown>
  ): Promise<KYBVerificationResult>;
}

export type OracleConfidenceLevel = 'low' | 'medium' | 'high';

// ── External verification provider (KYB / identity attestation) ──────────────

/**
 * Outcome of an external provider lookup for a payer.
 *
 * `unknown` is deliberately distinct from `unverified`. A provider that is not
 * configured, times out, or has no record for the payer tells us nothing — and
 * "we could not check" must never be treated as "we checked and they failed",
 * which would let an outage silently reject every payer.
 */
export type ExternalVerificationStatus = 'verified' | 'unverified' | 'unknown';

export interface ExternalVerificationResult {
  status: ExternalVerificationStatus;
  /** Provider identifier, surfaced so the frontend can attribute the signal. */
  provider: string;
  /** Provider's own confidence in its attestation, 0..1, when it reports one. */
  providerConfidence?: number;
  /** ISO timestamp of the attestation, used for staleness reporting. */
  checkedAt?: string;
  /** Human-readable notes to fold into the response evidence. */
  reasons?: string[];
}

/** Pluggable port for an external KYB/identity provider. */
export interface ExternalVerificationProvider {
  (payer: string): Promise<ExternalVerificationResult>;
}

// ── Signal composition ───────────────────────────────────────────────────────

/**
 * Which signal determined the final verdict. Exposed so the frontend's
 * OracleBadge can distinguish "clean and attested" from "clean but unattested"
 * from "attested but behaving fraudulently" without re-deriving the policy.
 */
export type OracleCompositionOutcome =
  | 'verified-both'
  | 'verified-heuristic-only'
  | 'rejected-fraud-signals'
  | 'rejected-low-trust'
  | 'rejected-stale-data';

/** The heuristic sub-signal, reported alongside the composed verdict. */
export interface OracleHeuristicSignal {
  trustScore: number;
  confidence: number;
  confidenceLevel: OracleConfidenceLevel;
  fraudSignals: string[];
  passed: boolean;
}

/** The external sub-signal, reported alongside the composed verdict. */
export interface OracleExternalSignal {
  status: ExternalVerificationStatus;
  provider: string | null;
  providerConfidence: number | null;
  checkedAt: string | null;
  reasons: string[];
}

/** Full composition detail attached to every verification response. */
export interface OracleSignalComposition {
  /** Version of the composition policy that produced this verdict. */
  policy: string;
  outcome: OracleCompositionOutcome;
  /** Short explanation of which rule decided the verdict. */
  rationale: string;
  heuristic: OracleHeuristicSignal;
  external: OracleExternalSignal;
  /** Confidence before the external signal was applied. */
  baseConfidence: number;
  /** Confidence after composition — the value in `confidence`. */
  composedConfidence: number;
}

export interface OracleVerificationResponse {
  requestId: string;
  payer: string;
  invoiceId: string;
  amount: string;
  trustScore: number;
  confidence: number;
  confidenceLevel: OracleConfidenceLevel;
  isVerified: boolean;
  generatedAt: string;
  dataAgeMs: number;
  cacheHit: boolean;
  reputationScore: number;
  historicalSuccessRate: number;
  historicalDefaultRate: number;
  averageHistoricalAmount: string;
  amountDeviation: number;
  settlementVarianceDays: number;
  fraudSignals: string[];
  evidence: string[];
  /**
   * Both sub-scores and the rule that decided the verdict, not just the final
   * boolean, so consumers can render the four verified/fraud combinations
   * distinctly.
   */
  composition: OracleSignalComposition;
  kybResult?: KYBVerificationResult;
}

export interface OracleAssessmentInput {
  request: OracleVerificationRequest;
  reputation: ReputationSnapshot;
  history: IndexerInvoiceHistoryEntry[];
  nowMs: number;
  maxOracleAgeMs: number;
  /** Omitted when no external provider is configured — treated as `unknown`. */
  external?: ExternalVerificationResult;
  kybResult?: KYBVerificationResult;
}

export interface OracleAssessment {
  response: OracleVerificationResponse;
  sourceTimestampMs: number;
}

export interface OracleCacheEntry {
  key: string;
  response: OracleVerificationResponse;
  generatedAtMs: number;
}

export interface OracleVerificationStats {
  verifications: number;
  cacheHits: number;
  cacheMisses: number;
  staleResponses: number;
}

export interface OracleServiceHealth {
  status: 'ok' | 'degraded';
  uptimeMs: number;
  cache: 'memory' | 'redis' | 'disabled';
  indexerBaseUrl: string;
  reputationConfigured: boolean;
  lastVerificationAt?: string | null;
}

export interface OracleServiceMetricsSnapshot {
  verifications: number;
  cacheHits: number;
  cacheMisses: number;
  staleResponses: number;
  inFlightRequests: number;
}

export interface OracleVerifierDependencies {
  historyProvider: (payer: string) => Promise<IndexerInvoiceHistoryEntry[]>;
  reputationProvider: (payer: string) => Promise<ReputationSnapshot>;
  kybProvider?: VerificationProvider;
  cache?: OracleCacheReaderWriter;
  now?: () => number;
  cacheTtlSeconds?: number;
  maxOracleAgeMs?: number;
  externalProvider?: ExternalVerificationProvider;
}

export interface OracleCacheReaderWriter {
  get(key: string): Promise<OracleCacheEntry | null>;
  set(key: string, response: OracleVerificationResponse, ttlSeconds: number): Promise<void>;
  /**
   * Drop every entry under a key prefix. Used to invalidate a payer's cached
   * verdicts the moment new activity for that payer is observed, so a clean
   * result cannot outlive the behaviour it was based on.
   *
   * Optional so existing custom cache implementations keep compiling; callers
   * must treat its absence as "invalidation unsupported", not as success.
   */
  invalidateByPrefix?(prefix: string): Promise<number>;
}

export interface OracleServiceOptions {
  port: number;
  indexerBaseUrl: string;
  reputationRpcUrl?: string;
  reputationContractId?: string;
  cacheTtlSeconds: number;
  requestTimeoutMs: number;
  maxOracleAgeMs: number;
  redisUrl?: string;
  cache?: OracleCacheReaderWriter;
  historyProvider?: (payer: string) => Promise<IndexerInvoiceHistoryEntry[]>;
  reputationProvider?: (payer: string) => Promise<ReputationSnapshot>;
  externalProvider?: ExternalVerificationProvider;
  kybProvider?: VerificationProvider;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  enableRateLimit?: boolean;
}

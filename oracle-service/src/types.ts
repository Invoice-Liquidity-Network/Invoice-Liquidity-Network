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

export type OracleConfidenceLevel = 'low' | 'medium' | 'high';

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
}

export interface OracleAssessmentInput {
  request: OracleVerificationRequest;
  reputation: ReputationSnapshot;
  history: IndexerInvoiceHistoryEntry[];
  nowMs: number;
  maxOracleAgeMs: number;
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
  cache?: OracleCacheReaderWriter;
  now?: () => number;
  cacheTtlSeconds?: number;
  maxOracleAgeMs?: number;
}

export interface OracleCacheReaderWriter {
  get(key: string): Promise<OracleCacheEntry | null>;
  set(key: string, response: OracleVerificationResponse, ttlSeconds: number): Promise<void>;
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
}

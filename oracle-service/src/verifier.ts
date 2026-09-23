import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc as SorobanRpc,
  scValToNative,
  xdr as stellarXdr,
} from '@stellar/stellar-sdk';

import type {
  IndexerInvoiceHistoryEntry,
  OracleAssessment,
  OracleAssessmentInput,
  OracleConfidenceLevel,
  OracleVerificationRequest,
  OracleVerificationResponse,
  ReputationSnapshot,
  OracleVerifierDependencies,
} from './types';
import type { OracleCacheReaderWriter } from './types';
import { buildOracleCacheKey } from './cache';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FRAUD_WINDOW_MS = 30 * DAY_MS;
const RAPID_SUCCESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function normalizeAmountToNumber(value: string | number | bigint): number {
  try {
    const amount = typeof value === 'bigint' ? value : BigInt(String(value));
    const asNumber = Number(amount);
    return Number.isFinite(asNumber) ? asNumber : Number.MAX_SAFE_INTEGER;
  } catch {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }
}

export function normalizeTimestampToMs(value: number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = average(values);
  return average(values.map((value) => (value - mean) ** 2));
}

function standardDeviation(values: number[]): number {
  return Math.sqrt(variance(values));
}

function confidenceLevelFromScore(confidence: number): OracleConfidenceLevel {
  if (confidence < 0.4) {
    return 'low';
  }
  if (confidence < 0.75) {
    return 'medium';
  }
  return 'high';
}

function successRateFromHistory(history: IndexerInvoiceHistoryEntry[]): number {
  if (history.length === 0) {
    return 0;
  }
  const paid = history.filter((entry) => entry.status === 'Paid').length;
  return paid / history.length;
}

function defaultRateFromHistory(history: IndexerInvoiceHistoryEntry[]): number {
  if (history.length === 0) {
    return 0;
  }
  const defaulted = history.filter((entry) => entry.status === 'Defaulted').length;
  return defaulted / history.length;
}

function averageHistoricalAmount(history: IndexerInvoiceHistoryEntry[]): number {
  const values = history
    .map((entry) => normalizeAmountToNumber(entry.amount))
    .filter((value) => value > 0);
  return average(values);
}

function amountDeviationPercent(requestAmount: number, historicalAverage: number): number {
  if (historicalAverage <= 0) {
    return 100;
  }
  return (Math.abs(requestAmount - historicalAverage) / historicalAverage) * 100;
}

function settlementDurationsDays(history: IndexerInvoiceHistoryEntry[]): number[] {
  return history
    .filter((entry) => entry.status === 'Paid')
    .map((entry) => {
      const settledAt = normalizeTimestampToMs(entry.updated_at);
      const fundedAt = normalizeTimestampToMs(entry.funded_at ?? entry.created_at);
      if (!settledAt || !fundedAt || settledAt <= fundedAt) {
        return 0;
      }
      return (settledAt - fundedAt) / DAY_MS;
    })
    .filter((value) => value > 0);
}

function latestSourceTimestampMs(
  history: IndexerInvoiceHistoryEntry[],
  reputation: ReputationSnapshot
): number {
  const historyMax = history.reduce((max, entry) => {
    const updated = normalizeTimestampToMs(entry.updated_at);
    const created = normalizeTimestampToMs(entry.created_at);
    const funded = normalizeTimestampToMs(entry.funded_at ?? null);
    return Math.max(max, updated, created, funded);
  }, 0);

  const reputationTimestamp = normalizeTimestampToMs(reputation.lastActivity);
  return Math.max(historyMax, reputationTimestamp);
}

function detectFraudSignals(
  history: IndexerInvoiceHistoryEntry[],
  requestAmount: number,
  nowMs: number
): string[] {
  const signals = new Set<string>();
  const recentHistory = history
    .slice()
    .sort((a, b) => normalizeTimestampToMs(b.created_at) - normalizeTimestampToMs(a.created_at))
    .filter((entry) => nowMs - normalizeTimestampToMs(entry.updated_at) <= MAX_FRAUD_WINDOW_MS);

  const similarAmountMatches = recentHistory.filter((entry) => {
    const historicalAmount = normalizeAmountToNumber(entry.amount);
    if (historicalAmount <= 0 || requestAmount <= 0) {
      return false;
    }
    const delta =
      Math.abs(historicalAmount - requestAmount) / Math.max(historicalAmount, requestAmount);
    return delta <= 0.05;
  });

  if (similarAmountMatches.length >= 3) {
    signals.add('Multiple recent invoices with similar amounts from the same payer');
  }

  const rapidSuccessionWindows: number[] = [];
  for (const entry of recentHistory) {
    rapidSuccessionWindows.push(normalizeTimestampToMs(entry.created_at));
  }
  rapidSuccessionWindows.sort((a, b) => a - b);

  let rapidClusters = 0;
  for (let i = 0; i < rapidSuccessionWindows.length; i += 1) {
    let clusterSize = 1;
    for (let j = i + 1; j < rapidSuccessionWindows.length; j += 1) {
      if (rapidSuccessionWindows[j] - rapidSuccessionWindows[i] <= RAPID_SUCCESSION_WINDOW_MS) {
        clusterSize += 1;
      }
    }
    if (clusterSize >= 3) {
      rapidClusters += 1;
      break;
    }
  }

  if (rapidClusters > 0) {
    signals.add('Rapid succession of invoices detected for the same payer');
  }

  const defaultedRecent = recentHistory.filter((entry) => entry.status === 'Defaulted').length;
  if (defaultedRecent >= 2) {
    signals.add('Recent default concentration suggests elevated fraud risk');
  }

  const repeatedUpdatedAt = new Map<number, number>();
  for (const entry of recentHistory) {
    const updatedAt = normalizeTimestampToMs(entry.updated_at);
    repeatedUpdatedAt.set(updatedAt, (repeatedUpdatedAt.get(updatedAt) ?? 0) + 1);
  }
  if ([...repeatedUpdatedAt.values()].some((count) => count >= 4)) {
    signals.add('Repeated invoice updates clustered in the same ledger window');
  }

  return [...signals];
}

function computeTrustScore(
  reputation: ReputationSnapshot,
  history: IndexerInvoiceHistoryEntry[],
  requestAmount: number,
  nowMs: number
): {
  trustScore: number;
  confidence: number;
  confidenceLevel: OracleConfidenceLevel;
  evidence: string[];
  fraudSignals: string[];
  historicalAverageAmount: number;
  historicalSuccessRate: number;
  historicalDefaultRate: number;
  settlementVarianceDays: number;
  amountDeviation: number;
  sourceTimestampMs: number;
} {
  const evidence: string[] = [];
  const fraudSignals = detectFraudSignals(history, requestAmount, nowMs);

  const reputationScore = clamp(Math.round(reputation.score ?? 0), 0, 100);
  const successRate = successRateFromHistory(history);
  const defaultRate = defaultRateFromHistory(history);
  const historicalAverageAmount = averageHistoricalAmount(history);
  const amountDeviation = amountDeviationPercent(requestAmount, historicalAverageAmount);
  const durations = settlementDurationsDays(history);
  const settlementVarianceDays = variance(durations);
  const settlementStdDevDays = standardDeviation(durations);

  const amountFitScore = clamp(100 - amountDeviation * 1.2, 0, 100);
  const varianceFitScore = clamp(100 - settlementStdDevDays * 18, 0, 100);
  const successScore = successRate * 100;
  const defaultPenalty = defaultRate * 45;
  const fraudPenalty = fraudSignals.length === 0 ? 0 : Math.min(35, fraudSignals.length * 9);

  const trustScore = clamp(
    Math.round(
      reputationScore * 0.38 +
        successScore * 0.33 +
        amountFitScore * 0.17 +
        varianceFitScore * 0.12 -
        defaultPenalty -
        fraudPenalty
    ),
    0,
    100
  );

  const historyVolumeConfidence = history.length === 0 ? 0.05 : Math.min(1, history.length / 12);
  const reputationConfidence = reputationScore / 100;
  const dataFreshnessConfidence = 0.5;
  const confidence = clamp(
    round(
      historyVolumeConfidence * 0.45 + reputationConfidence * 0.35 + dataFreshnessConfidence * 0.2,
      4
    ),
    0,
    1
  );

  evidence.push(`On-chain reputation score: ${reputationScore}/100`);
  evidence.push(`Historical payment success rate: ${(successRate * 100).toFixed(1)}%`);
  evidence.push(`Historical default rate: ${(defaultRate * 100).toFixed(1)}%`);
  evidence.push(
    `Average historical invoice amount: ${Math.round(historicalAverageAmount).toString()}`
  );
  evidence.push(`Requested amount deviation: ${amountDeviation.toFixed(1)}%`);
  evidence.push(`Settlement variance: ${settlementVarianceDays.toFixed(2)} days`);

  if (history.length === 0) {
    evidence.push(
      'No payer history available from the indexer; score weighted toward reputation only'
    );
  }
  if (fraudSignals.length > 0) {
    evidence.push(`Fraud signals: ${fraudSignals.join('; ')}`);
  }

  return {
    trustScore,
    confidence,
    confidenceLevel: confidenceLevelFromScore(confidence),
    evidence,
    fraudSignals,
    historicalAverageAmount,
    historicalSuccessRate: successRate,
    historicalDefaultRate: defaultRate,
    settlementVarianceDays,
    amountDeviation,
    sourceTimestampMs: latestSourceTimestampMs(history, reputation) || nowMs,
  };
}

export function assessOracleRequest(input: OracleAssessmentInput): OracleAssessment {
  const requestAmount = normalizeAmountToNumber(input.request.amount);
  const computed = computeTrustScore(input.reputation, input.history, requestAmount, input.nowMs);
  const generatedAt = new Date(input.nowMs).toISOString();
  const dataAgeMs = Math.max(0, input.nowMs - computed.sourceTimestampMs);
  const isFresh = input.maxOracleAgeMs <= 0 || dataAgeMs <= input.maxOracleAgeMs;
  const isVerified =
    computed.trustScore >= 70 &&
    computed.confidence >= 0.55 &&
    computed.fraudSignals.length === 0 &&
    isFresh;

  return {
    sourceTimestampMs: computed.sourceTimestampMs,
    response: {
      requestId:
        input.request.requestId ??
        `${input.request.payer}:${input.request.invoiceId}:${input.nowMs}`,
      payer: input.request.payer,
      invoiceId: String(input.request.invoiceId),
      amount: String(
        BigInt(Math.max(0, Math.trunc(Number.isFinite(requestAmount) ? requestAmount : 0)))
      ),
      trustScore: computed.trustScore,
      confidence: computed.confidence,
      confidenceLevel: computed.confidenceLevel,
      isVerified,
      generatedAt,
      dataAgeMs,
      cacheHit: false,
      reputationScore: Math.max(0, Math.round(input.reputation.score ?? 0)),
      historicalSuccessRate: round(computed.historicalSuccessRate, 4),
      historicalDefaultRate: round(computed.historicalDefaultRate, 4),
      averageHistoricalAmount: String(Math.round(computed.historicalAverageAmount)),
      amountDeviation: round(computed.amountDeviation, 2),
      settlementVarianceDays: round(computed.settlementVarianceDays, 4),
      fraudSignals: computed.fraudSignals,
      evidence: computed.evidence,
    },
  };
}

export interface OracleHistoryProvider {
  (payer: string): Promise<IndexerInvoiceHistoryEntry[]>;
}

export interface OracleReputationProvider {
  (payer: string): Promise<ReputationSnapshot>;
}

export interface OracleVerifierOptions extends OracleVerifierDependencies {
  cache?: OracleCacheReaderWriter;
  cacheTtlSeconds?: number;
}

export class OracleVerifier {
  private readonly cache?: OracleCacheReaderWriter;
  private readonly now: () => number;
  private readonly cacheTtlSeconds: number;
  private readonly historyProvider: OracleHistoryProvider;
  private readonly reputationProvider: OracleReputationProvider;
  private readonly maxOracleAgeMs: number;
  private readonly inflight = new Map<string, Promise<OracleVerificationResponse>>();

  constructor(options: OracleVerifierOptions) {
    this.cache = options.cache;
    this.now = options.now ?? Date.now;
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 300;
    this.historyProvider = options.historyProvider;
    this.reputationProvider = options.reputationProvider;
    this.maxOracleAgeMs = options.maxOracleAgeMs ?? 5 * 60 * 1000;
  }

  async verify(request: OracleVerificationRequest): Promise<OracleVerificationResponse> {
    const normalizedRequest = {
      ...request,
      payer: request.payer.trim(),
      amount: String(BigInt(String(request.amount))),
      invoiceId: String(BigInt(String(request.invoiceId))),
    };
    const cacheKey = buildOracleCacheKey(normalizedRequest);

    if (!normalizedRequest.forceRefresh) {
      const cached = await this.cache?.get(cacheKey);
      if (cached) {
        return {
          ...cached.response,
          cacheHit: true,
          requestId: normalizedRequest.requestId ?? cached.response.requestId,
        };
      }
    }

    const inflight = this.inflight.get(cacheKey);
    if (inflight && !normalizedRequest.forceRefresh) {
      const response = await inflight;
      return { ...response, cacheHit: true };
    }

    const computePromise = this.computeVerification(normalizedRequest, cacheKey);
    if (!normalizedRequest.forceRefresh) {
      this.inflight.set(cacheKey, computePromise);
    }

    try {
      return await computePromise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  private async computeVerification(
    request: OracleVerificationRequest,
    cacheKey: string
  ): Promise<OracleVerificationResponse> {
    const nowMs = this.now();
    let history: IndexerInvoiceHistoryEntry[] = [];
    let reputation: ReputationSnapshot = {
      address: request.payer,
      score: 0,
      totalPaid: 0n,
      invoiceCount: 0,
      lastActivity: 0,
      rank: 0,
    };

    const [historyResult, reputationResult] = await Promise.allSettled([
      this.historyProvider(request.payer),
      this.reputationProvider(request.payer),
    ]);

    if (historyResult.status === 'fulfilled') {
      history = historyResult.value;
    }

    if (reputationResult.status === 'fulfilled') {
      reputation = reputationResult.value;
    }

    const assessment = assessOracleRequest({
      request,
      history,
      reputation,
      nowMs,
      maxOracleAgeMs: request.maxOracleAgeMs ?? this.maxOracleAgeMs,
    });

    const response: OracleVerificationResponse = {
      ...assessment.response,
      cacheHit: false,
    };

    await this.cache?.set(cacheKey, response, this.cacheTtlSeconds);
    return response;
  }
}

export interface LedgerRpcOracleOptions {
  rpcUrl: string;
  contractId: string;
  networkPassphrase?: string;
  source?: string;
}

export async function fetchOnChainReputation(
  options: LedgerRpcOracleOptions,
  address: string
): Promise<ReputationSnapshot> {
  try {
    const server = new SorobanRpc.Server(options.rpcUrl);
    const contract = new Contract(options.contractId);
    const source = options.source ?? Keypair.random().publicKey();
    const account = await server.getAccount(source);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: options.networkPassphrase ?? Networks.TESTNET,
    })
      .addOperation(contract.call('get_reputation', new Address(address).toScVal()))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if ('error' in simulation) {
      throw new Error(String(simulation.error));
    }
    const retval = simulation.result?.retval;
    if (!retval) {
      throw new Error('No return value');
    }

    const native = scValToNative(retval);
    const get = (key: string): unknown => {
      if (native instanceof Map) {
        return native.get(key);
      }
      return native && typeof native === 'object'
        ? (native as Record<string, unknown>)[key]
        : undefined;
    };

    return {
      address,
      score: Math.max(0, Number(get('score') ?? 0)) || 0,
      totalPaid: BigInt(String(get('total_paid') ?? '0')) || 0n,
      invoiceCount: Math.max(0, Number(get('invoice_count') ?? 0)) || 0,
      lastActivity: Math.max(0, Number(get('last_activity') ?? 0)) || 0,
      rank: Math.max(0, Number(get('rank') ?? 0)) || 0,
    };
  } catch {
    return {
      address,
      score: 0,
      totalPaid: 0n,
      invoiceCount: 0,
      lastActivity: 0,
      rank: 0,
    };
  }
}

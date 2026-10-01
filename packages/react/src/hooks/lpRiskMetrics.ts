import type { Invoice, LPPortfolio } from '@iln/sdk';

export interface LPRiskPayerExposure {
  payer: string;
  amount: bigint;
  share: number;
  positionCount: number;
  defaultProbability: number;
  reputationScore: number;
}

export interface LPRiskTokenDiversification {
  token: string;
  amount: bigint;
  share: number;
  positionCount: number;
}

export interface LPRiskMaturityBucket {
  label: '0-7d' | '7-30d' | '30-90d' | '90d+';
  amount: bigint;
  share: number;
  positionCount: number;
}

export interface LPRiskMetrics {
  totalPositions: number;
  totalExposure: bigint;
  payerExposure: LPRiskPayerExposure[];
  tokenDiversification: LPRiskTokenDiversification[];
  maturityProfile: LPRiskMaturityBucket[];
  giniCoefficient: number;
  herfindahlHirschmanIndex: number;
  valueAtRisk95: bigint;
  sharpeRatio: number;
  defaultProbabilityEstimate: number;
  yieldAdjustedRiskScore: number;
  herdRisk: boolean;
  herdShare: number;
  expectedLoss: bigint;
  expectedYield: bigint;
}

export interface LPRiskMetricsInput {
  address: string;
  invoices: Invoice[];
  portfolio?: LPPortfolio;
  reputationByPayer?: Map<string, number>;
  now?: number;
  simulations?: number;
}

const BASIS_POINTS = 10_000;
const SECONDS_PER_DAY = 86_400;
const MaturityLabels = ['0-7d', '7-30d', '30-90d', '90d+'] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toBigIntValue(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return BigInt(value);
  }
  return 0n;
}

function toNumberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeTimestampSeconds(value: unknown): number {
  const raw = toNumberValue(value);
  if (raw <= 0) {
    return 0;
  }
  return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : Math.floor(raw);
}

function normalizeReputationScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) {
    return 0;
  }
  if (score > 100) {
    return clamp(score / 10, 0, 100);
  }
  return clamp(score, 0, 100);
}

function normalizeTokenLabel(token: unknown): string {
  const value = String(token ?? '').trim();
  const upper = value.toUpperCase();
  if (upper.includes('USDC')) {
    return 'USDC';
  }
  if (upper.includes('EURC')) {
    return 'EURC';
  }
  if (upper === 'XLM' || upper.includes('NATIVE')) {
    return 'XLM';
  }
  if (value.length <= 10) {
    return value || 'Unknown';
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function readPortfolioNumber(portfolio: LPPortfolio | undefined, keys: string[]): number {
  if (!portfolio) {
    return 0;
  }
  const record = portfolio as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined) {
      return toNumberValue(record[key]);
    }
  }
  return 0;
}

function giniCoefficient(values: number[]): number {
  const filtered = values.filter((value) => Number.isFinite(value) && value >= 0);
  const n = filtered.length;
  if (n === 0) {
    return 0;
  }

  const sorted = [...filtered].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  if (sum === 0) {
    return 0;
  }

  let weighted = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    weighted += (index + 1) * sorted[index];
  }

  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

function herfindahlHirschmanIndex(shares: number[]): number {
  return shares.reduce((acc, share) => acc + share * share, 0) * 10_000;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const avg = mean(values);
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function seedFromString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function estimateDefaultProbability(
  reputationScore: number,
  historicalDefaultRate: number
): number {
  const normalizedRep = normalizeReputationScore(reputationScore);
  const repPenalty = 1 - normalizedRep / 100;
  const blended = historicalDefaultRate * (1 + repPenalty);
  return clamp(blended, 0.01, 0.95);
}

function calculateBucketLabel(daysUntilDue: number): LPRiskMaturityBucket['label'] {
  if (daysUntilDue <= 7) {
    return '0-7d';
  }
  if (daysUntilDue <= 30) {
    return '7-30d';
  }
  if (daysUntilDue <= 90) {
    return '30-90d';
  }
  return '90d+';
}

function annualizedReturnRate(
  amount: bigint,
  discountRateBps: number,
  daysUntilDue: number
): number {
  if (amount <= 0n || daysUntilDue <= 0) {
    return 0;
  }
  const rate = discountRateBps / BASIS_POINTS;
  return rate * (365.25 / Math.max(daysUntilDue, 1));
}

function simulateValueAtRisk(
  losses: Array<{ amount: number; probability: number }>,
  seed: string,
  simulations: number
): bigint {
  if (losses.length === 0 || simulations <= 0) {
    return 0n;
  }

  const random = mulberry32(seedFromString(seed));
  const simulatedTotals: number[] = [];

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    let totalLoss = 0;
    for (const entry of losses) {
      if (random() < entry.probability) {
        totalLoss += entry.amount;
      }
    }
    simulatedTotals.push(totalLoss);
  }

  return BigInt(Math.round(percentile(simulatedTotals, 95)));
}

export function calculateLPRiskMetrics(input: LPRiskMetricsInput): LPRiskMetrics {
  const nowSeconds = normalizeTimestampSeconds(input.now ?? Date.now());
  const validInvoices = input.invoices.filter((invoice) => {
    const record = invoice as unknown as Record<string, unknown>;
    const fundedBy = String(record.fundedBy ?? record.funder ?? '');
    return fundedBy.length === 0 || fundedBy === input.address;
  });

  const positionSummaries = validInvoices.map((invoice) => {
    const record = invoice as unknown as Record<string, unknown>;
    const payer = String(record.payer ?? '');
    const token = normalizeTokenLabel(record.token);
    const amount = toBigIntValue(record.amount);
    const discountRate = toNumberValue(record.discountRate);
    const dueDateSeconds = normalizeTimestampSeconds(record.dueDate);
    const daysUntilDue = Math.max(0, Math.floor((dueDateSeconds - nowSeconds) / SECONDS_PER_DAY));
    const annualReturnRate = annualizedReturnRate(amount, discountRate, daysUntilDue);

    return {
      payer,
      token,
      amount,
      discountRate,
      dueDateSeconds,
      daysUntilDue,
      annualReturnRate,
    };
  });

  const totalExposure = positionSummaries.reduce((acc, position) => acc + position.amount, 0n);
  const exposureNumber = Number(totalExposure);
  const totalPositions = positionSummaries.length;

  const payerGroups = new Map<
    string,
    {
      amount: bigint;
      positionCount: number;
      reputationScore: number;
      defaultProbability: number;
    }
  >();
  const tokenGroups = new Map<
    string,
    {
      amount: bigint;
      positionCount: number;
    }
  >();
  const maturityGroups = new Map<
    LPRiskMaturityBucket['label'],
    {
      amount: bigint;
      positionCount: number;
    }
  >();

  const historicalDefaultRate = (() => {
    const totalHistoricalPositions =
      readPortfolioNumber(input.portfolio, ['invoiceCount']) ||
      readPortfolioNumber(input.portfolio, ['activePositions']) +
        readPortfolioNumber(input.portfolio, ['completedPositions']) +
        readPortfolioNumber(input.portfolio, ['defaultedPositions']) +
        readPortfolioNumber(input.portfolio, ['activeInvoices']) +
        readPortfolioNumber(input.portfolio, ['defaultCount']);

    const defaulted =
      readPortfolioNumber(input.portfolio, ['defaultedPositions']) ||
      readPortfolioNumber(input.portfolio, ['defaultCount']);

    if (totalHistoricalPositions <= 0) {
      return 0.08;
    }

    return clamp(defaulted / totalHistoricalPositions, 0, 1);
  })();

  const expectedLossEntries: Array<{ amount: number; probability: number }> = [];
  const yieldEntries: number[] = [];
  const returnRates: number[] = [];

  for (const position of positionSummaries) {
    const reputationScore = normalizeReputationScore(
      input.reputationByPayer?.get(position.payer) ?? 0
    );
    const defaultProbability = estimateDefaultProbability(reputationScore, historicalDefaultRate);
    const exposureAmount = Number(position.amount);

    expectedLossEntries.push({
      amount: exposureAmount,
      probability: defaultProbability,
    });
    yieldEntries.push(exposureAmount * (position.discountRate / BASIS_POINTS));
    returnRates.push(position.annualReturnRate);

    const payerEntry = payerGroups.get(position.payer) ?? {
      amount: 0n,
      positionCount: 0,
      reputationScore,
      defaultProbability,
    };
    payerGroups.set(position.payer, {
      amount: payerEntry.amount + position.amount,
      positionCount: payerEntry.positionCount + 1,
      reputationScore: reputationScore || payerEntry.reputationScore,
      defaultProbability: defaultProbability || payerEntry.defaultProbability,
    });

    const tokenEntry = tokenGroups.get(position.token) ?? {
      amount: 0n,
      positionCount: 0,
    };
    tokenGroups.set(position.token, {
      amount: tokenEntry.amount + position.amount,
      positionCount: tokenEntry.positionCount + 1,
    });

    const maturityLabel = calculateBucketLabel(position.daysUntilDue);
    const maturityEntry = maturityGroups.get(maturityLabel) ?? {
      amount: 0n,
      positionCount: 0,
    };
    maturityGroups.set(maturityLabel, {
      amount: maturityEntry.amount + position.amount,
      positionCount: maturityEntry.positionCount + 1,
    });
  }

  const payerExposure = [...payerGroups.entries()]
    .map(([payer, entry]) => {
      const amountNumber = Number(entry.amount);
      return {
        payer,
        amount: entry.amount,
        share: exposureNumber > 0 ? amountNumber / exposureNumber : 0,
        positionCount: entry.positionCount,
        defaultProbability: entry.defaultProbability,
        reputationScore: entry.reputationScore,
      };
    })
    .sort((a, b) => b.share - a.share);

  const tokenDiversification = [...tokenGroups.entries()]
    .map(([token, entry]) => {
      const amountNumber = Number(entry.amount);
      return {
        token,
        amount: entry.amount,
        share: exposureNumber > 0 ? amountNumber / exposureNumber : 0,
        positionCount: entry.positionCount,
      };
    })
    .sort((a, b) => b.share - a.share);

  const maturityProfile = MaturityLabels.map((label) => {
    const entry = maturityGroups.get(label) ?? { amount: 0n, positionCount: 0 };
    const amountNumber = Number(entry.amount);
    return {
      label,
      amount: entry.amount,
      share: exposureNumber > 0 ? amountNumber / exposureNumber : 0,
      positionCount: entry.positionCount,
    };
  });

  const topShare = payerExposure[0]?.share ?? 0;
  const herdRisk = topShare > 0.3;

  const giniCoefficientValue = giniCoefficient(
    positionSummaries.map((position) => Number(position.amount))
  );
  const herfindahlValue = herfindahlHirschmanIndex(payerExposure.map((entry) => entry.share));
  const valueAtRisk95 = simulateValueAtRisk(
    expectedLossEntries,
    input.address,
    input.simulations ?? 5_000
  );
  const sharpeRatio =
    standardDeviation(returnRates) > 0 ? mean(returnRates) / standardDeviation(returnRates) : 0;

  const totalExpectedLoss = expectedLossEntries.reduce(
    (acc, entry) => acc + entry.amount * entry.probability,
    0
  );
  const totalExpectedYield = yieldEntries.reduce((acc, value) => acc + value, 0);
  const averageDefaultProbability =
    payerExposure.length > 0
      ? payerExposure.reduce((acc, entry) => acc + entry.defaultProbability * entry.share, 0)
      : 0;
  const concentrationPenalty = herdRisk ? (topShare - 0.3) * exposureNumber : 0;
  const yieldAdjustedRiskScore =
    totalExpectedLoss + concentrationPenalty > 0
      ? totalExpectedYield / (totalExpectedLoss + concentrationPenalty)
      : 0;

  return {
    totalPositions,
    totalExposure,
    payerExposure,
    tokenDiversification,
    maturityProfile,
    giniCoefficient: giniCoefficientValue,
    herfindahlHirschmanIndex: herfindahlValue,
    valueAtRisk95,
    sharpeRatio,
    defaultProbabilityEstimate: averageDefaultProbability,
    yieldAdjustedRiskScore,
    herdRisk,
    herdShare: topShare,
    expectedLoss: BigInt(Math.round(totalExpectedLoss)),
    expectedYield: BigInt(Math.round(totalExpectedYield)),
  };
}

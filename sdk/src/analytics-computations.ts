export interface YieldProjection {
  invoiceAmount: bigint;
  discountRate: number;
  daysUntilDue: number;
  annualizedYield: bigint;
  expectedReturn: bigint;
  effectiveApr: number;
}

export interface RiskFactors {
  amountScore: number;
  durationScore: number;
  discountScore: number;
  overallScore: number;
}

export interface PortfolioAllocation {
  totalDeployed: bigint;
  totalAvailable: bigint;
  utilizationRate: number;
  allocationByToken: Map<string, { deployed: bigint; count: number }>;
  concentrationIndex: number;
}

export interface HistoricalPerformance {
  totalInvoices: number;
  fundedCount: number;
  paidCount: number;
  defaultedCount: number;
  defaultRate: number;
  totalVolume: bigint;
  totalYield: bigint;
  avgDiscountRate: number;
  avgDaysToSettlement: number;
}

export interface ComparisonResult {
  metric: string;
  valueA: number | bigint;
  valueB: number | bigint;
  difference: number;
  percentDifference: number;
}

const SECONDS_PER_DAY = 86400;
const BASIS_POINTS_DIVISOR = 10000;

export function calculateYieldProjection(
  invoiceAmount: bigint,
  discountRateBps: number,
  daysUntilDue: number
): YieldProjection {
  const discountAmount = (invoiceAmount * BigInt(discountRateBps)) / BigInt(BASIS_POINTS_DIVISOR);
  const expectedReturn = invoiceAmount - discountAmount;

  const durationFraction = daysUntilDue / 365.25;
  const annualizedYield =
    durationFraction > 0 ? BigInt(Math.round(Number(discountAmount) / durationFraction)) : 0n;

  const effectiveApr =
    daysUntilDue > 0
      ? (Number(discountAmount) / Number(invoiceAmount)) * (365.25 / daysUntilDue) * 100
      : 0;

  return {
    invoiceAmount,
    discountRate: discountRateBps,
    daysUntilDue,
    annualizedYield,
    expectedReturn,
    effectiveApr,
  };
}

export function calculateRiskScore(
  amount: bigint,
  daysUntilDue: number,
  discountRateBps: number
): RiskFactors {
  const amountScore = amount <= 1000n * 1000000n ? 10 : amount <= 10000n * 1000000n ? 5 : 2;

  const durationScore =
    daysUntilDue <= 30 ? 10 : daysUntilDue <= 90 ? 7 : daysUntilDue <= 180 ? 4 : 2;

  const discountScore =
    discountRateBps >= 1000 ? 10 : discountRateBps >= 500 ? 7 : discountRateBps >= 200 ? 4 : 2;

  const overallScore = Math.round((amountScore + durationScore + discountScore) / 3);

  return {
    amountScore,
    durationScore,
    discountScore,
    overallScore,
  };
}

export function calculatePortfolioAllocation(
  invoices: Array<{ amount: bigint; status: string; token?: string }>
): PortfolioAllocation {
  let totalDeployed = 0n;
  let totalAvailable = 0n;
  const tokenMap = new Map<string, { deployed: bigint; count: number }>();

  for (const invoice of invoices) {
    const token = invoice.token ?? 'unknown';

    if (invoice.status === 'Funded' || invoice.status === 'Paid') {
      totalDeployed += invoice.amount;
      const existing = tokenMap.get(token) ?? { deployed: 0n, count: 0 };
      tokenMap.set(token, {
        deployed: existing.deployed + invoice.amount,
        count: existing.count + 1,
      });
    } else if (invoice.status === 'Pending') {
      totalAvailable += invoice.amount;
    }
  }

  const totalValue = totalDeployed + totalAvailable;
  const utilizationRate =
    totalValue > 0n ? Number((totalDeployed * BigInt(10000)) / totalValue) / 100 : 0;

  const totalDeployedNum = Number(totalDeployed);
  let concentrationIndex = 0;
  if (totalDeployedNum > 0) {
    for (const [, { deployed }] of tokenMap) {
      const share = Number(deployed) / totalDeployedNum;
      concentrationIndex += share * share;
    }
  }

  return {
    totalDeployed,
    totalAvailable,
    utilizationRate,
    allocationByToken: tokenMap,
    concentrationIndex,
  };
}

export function calculateHistoricalPerformance(
  events: Array<{
    type: string;
    amount: bigint;
    discountRate?: number;
    createdAt: number;
    settledAt?: number;
  }>
): HistoricalPerformance {
  let totalInvoices = 0;
  let fundedCount = 0;
  let paidCount = 0;
  let defaultedCount = 0;
  let totalVolume = 0n;
  let totalYield = 0n;
  let discountSum = 0;
  let discountCount = 0;
  const settlementDays: number[] = [];

  const submitted = new Map<string, (typeof events)[0]>();

  for (const event of events) {
    if (event.type === 'submitted') {
      submitted.set(String(event.amount), event);
      totalInvoices++;
      totalVolume += event.amount;
      if (event.discountRate !== undefined) {
        discountSum += event.discountRate;
        discountCount++;
      }
    } else if (event.type === 'funded') {
      fundedCount++;
    } else if (event.type === 'paid') {
      paidCount++;
      const submitEvent = submitted.get(String(event.amount));
      if (submitEvent && event.settledAt) {
        const days = (event.settledAt - submitEvent.createdAt) / (SECONDS_PER_DAY * 1000);
        settlementDays.push(days);
        if (submitEvent.discountRate !== undefined) {
          totalYield +=
            (event.amount * BigInt(submitEvent.discountRate)) / BigInt(BASIS_POINTS_DIVISOR);
        }
      }
    } else if (event.type === 'defaulted') {
      defaultedCount++;
    }
  }

  return {
    totalInvoices,
    fundedCount,
    paidCount,
    defaultedCount,
    defaultRate: totalInvoices > 0 ? defaultedCount / totalInvoices : 0,
    totalVolume,
    totalYield,
    avgDiscountRate: discountCount > 0 ? discountSum / discountCount : 0,
    avgDaysToSettlement:
      settlementDays.length > 0
        ? settlementDays.reduce((a, b) => a + b, 0) / settlementDays.length
        : 0,
  };
}

export function compareMetrics(
  name: string,
  valueA: number | bigint,
  valueB: number | bigint
): ComparisonResult {
  const numA = Number(valueA);
  const numB = Number(valueB);
  const difference = numA - numB;
  const percentDifference = numB !== 0 ? (difference / numB) * 100 : 0;

  return {
    metric: name,
    valueA,
    valueB,
    difference,
    percentDifference,
  };
}

import { describe, it, expect } from 'vitest';
import {
  calculateYieldProjection,
  calculateRiskScore,
  calculatePortfolioAllocation,
  calculateHistoricalPerformance,
  compareMetrics,
} from './analytics-computations';

describe('calculateYieldProjection', () => {
  it('calculates yield for a standard invoice', () => {
    const result = calculateYieldProjection(100000000n, 300, 30);
    expect(result.invoiceAmount).toBe(100000000n);
    expect(result.discountRate).toBe(300);
    expect(result.daysUntilDue).toBe(30);
    expect(result.expectedReturn).toBe(97000000n);
    expect(result.effectiveApr).toBeGreaterThan(0);
  });

  it('handles zero days until due', () => {
    const result = calculateYieldProjection(100000000n, 300, 0);
    expect(result.annualizedYield).toBe(0n);
    expect(result.effectiveApr).toBe(0);
  });

  it('handles large invoice amounts', () => {
    const result = calculateYieldProjection(1000000000000n, 500, 90);
    expect(result.expectedReturn).toBe(950000000000n);
    expect(result.effectiveApr).toBeGreaterThan(0);
  });

  it('handles zero discount rate', () => {
    const result = calculateYieldProjection(100000000n, 0, 30);
    expect(result.expectedReturn).toBe(100000000n);
    expect(result.annualizedYield).toBe(0n);
  });
});

describe('calculateRiskScore', () => {
  it('returns low risk for small short-term invoices', () => {
    const result = calculateRiskScore(500000000n, 15, 200);
    expect(result.overallScore).toBeGreaterThanOrEqual(7);
    expect(result.amountScore).toBe(10);
    expect(result.durationScore).toBe(10);
  });

  it('returns high risk for large long-term invoices', () => {
    const result = calculateRiskScore(50000000000n, 200, 100);
    expect(result.amountScore).toBe(2);
    expect(result.durationScore).toBe(2);
  });

  it('scores duration correctly at boundaries', () => {
    expect(calculateRiskScore(100000000n, 30, 300).durationScore).toBe(10);
    expect(calculateRiskScore(100000000n, 90, 300).durationScore).toBe(7);
    expect(calculateRiskScore(100000000n, 180, 300).durationScore).toBe(4);
    expect(calculateRiskScore(100000000n, 365, 300).durationScore).toBe(2);
  });

  it('overall score is average of all factors', () => {
    const result = calculateRiskScore(100000000n, 30, 500);
    const expected = Math.round((result.amountScore + result.durationScore + result.discountScore) / 3);
    expect(result.overallScore).toBe(expected);
  });
});

describe('calculatePortfolioAllocation', () => {
  it('calculates allocation for mixed portfolio', () => {
    const invoices = [
      { amount: 100000000n, status: 'Funded', token: 'USDC' },
      { amount: 200000000n, status: 'Paid', token: 'USDC' },
      { amount: 50000000n, status: 'Pending', token: 'EURC' },
      { amount: 150000000n, status: 'Funded', token: 'EURC' },
    ];
    const result = calculatePortfolioAllocation(invoices);
    expect(result.totalDeployed).toBe(450000000n);
    expect(result.totalAvailable).toBe(50000000n);
    expect(result.utilizationRate).toBe(90);
    expect(result.allocationByToken.size).toBe(2);
  });

  it('handles empty portfolio', () => {
    const result = calculatePortfolioAllocation([]);
    expect(result.totalDeployed).toBe(0n);
    expect(result.totalAvailable).toBe(0n);
    expect(result.utilizationRate).toBe(0);
    expect(result.concentrationIndex).toBe(0);
  });

  it('handles single token portfolio', () => {
    const invoices = [
      { amount: 100000000n, status: 'Funded', token: 'USDC' },
      { amount: 200000000n, status: 'Paid', token: 'USDC' },
    ];
    const result = calculatePortfolioAllocation(invoices);
    expect(result.concentrationIndex).toBe(1);
  });

  it('handles Defaulted status as not deployed', () => {
    const invoices = [
      { amount: 100000000n, status: 'Defaulted', token: 'USDC' },
    ];
    const result = calculatePortfolioAllocation(invoices);
    expect(result.totalDeployed).toBe(0n);
    expect(result.totalAvailable).toBe(0n);
  });
});

describe('calculateHistoricalPerformance', () => {
  it('calculates performance from events', () => {
    const now = Date.now();
    const events = [
      { type: 'submitted', amount: 100000000n, discountRate: 300, createdAt: now - 86400000 * 30 },
      { type: 'funded', amount: 100000000n, createdAt: now - 86400000 * 28 },
      { type: 'paid', amount: 100000000n, createdAt: now, settledAt: now },
    ];
    const result = calculateHistoricalPerformance(events);
    expect(result.totalInvoices).toBe(1);
    expect(result.fundedCount).toBe(1);
    expect(result.paidCount).toBe(1);
    expect(result.defaultRate).toBe(0);
    expect(result.totalVolume).toBe(100000000n);
    expect(result.avgDiscountRate).toBe(300);
  });

  it('handles defaults correctly', () => {
    const events = [
      { type: 'submitted', amount: 100000000n, createdAt: Date.now() - 86400000 * 60 },
      { type: 'funded', amount: 100000000n, createdAt: Date.now() - 86400000 * 58 },
      { type: 'defaulted', amount: 100000000n, createdAt: Date.now() },
    ];
    const result = calculateHistoricalPerformance(events);
    expect(result.defaultedCount).toBe(1);
    expect(result.defaultRate).toBe(1);
  });

  it('handles empty events', () => {
    const result = calculateHistoricalPerformance([]);
    expect(result.totalInvoices).toBe(0);
    expect(result.defaultRate).toBe(0);
    expect(result.totalVolume).toBe(0n);
  });

  it('calculates average settlement days', () => {
    const now = Date.now();
    const events = [
      { type: 'submitted', amount: 100000000n, discountRate: 300, createdAt: now - 86400000 * 30 },
      { type: 'submitted', amount: 200000000n, discountRate: 500, createdAt: now - 86400000 * 60 },
      { type: 'paid', amount: 100000000n, createdAt: now - 86400000 * 2, settledAt: now - 86400000 * 2 },
      { type: 'paid', amount: 200000000n, createdAt: now, settledAt: now },
    ];
    const result = calculateHistoricalPerformance(events);
    expect(result.avgDaysToSettlement).toBeGreaterThan(0);
    expect(result.totalYield).toBeGreaterThan(0n);
  });
});

describe('compareMetrics', () => {
  it('calculates positive difference', () => {
    const result = compareMetrics('yield', 500, 300);
    expect(result.difference).toBe(200);
    expect(result.percentDifference).toBeCloseTo(66.67, 1);
  });

  it('calculates negative difference', () => {
    const result = compareMetrics('yield', 300, 500);
    expect(result.difference).toBe(-200);
    expect(result.percentDifference).toBeCloseTo(-40, 1);
  });

  it('handles zero baseline', () => {
    const result = compareMetrics('yield', 500, 0);
    expect(result.percentDifference).toBe(0);
  });

  it('works with bigint values', () => {
    const result = compareMetrics('volume', 100000000n, 200000000n);
    expect(result.valueA).toBe(100000000n);
    expect(result.valueB).toBe(200000000n);
    expect(result.difference).toBe(-100000000);
  });
});

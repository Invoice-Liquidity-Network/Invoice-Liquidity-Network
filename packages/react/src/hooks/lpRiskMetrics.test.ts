import { describe, expect, it } from 'vitest';
import type { Invoice, LPPortfolio } from '@iln/sdk';
import { calculateLPRiskMetrics } from './lpRiskMetrics';

const NOW = Date.UTC(2026, 0, 1);
const ADDRESS = 'GLPTESTADDRESS000000000000000000000000000000000000000000';

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: (overrides.id ?? 1n) as bigint,
    issuer: 'GISSUER',
    payer: 'GPAYER',
    amount: 100n,
    discountRate: 300,
    dueDate: NOW + 86_400_000,
    status: 'Funded',
    fundedBy: ADDRESS,
    token: 'USDC_CONTRACT_ID',
    ...overrides,
  } as Invoice;
}

const portfolio = {
  address: ADDRESS,
  invoiceCount: 8,
  defaultedPositions: 1,
  completedPositions: 3,
  activePositions: 4,
  totalInvested: 300n,
  totalYield: 10n,
  avgReturn: 3.2,
} as unknown as LPPortfolio;

describe('calculateLPRiskMetrics', () => {
  it('derives concentration, diversification, and risk metrics from known positions', () => {
    const invoices = [
      makeInvoice({
        payer: 'GPAYER_A',
        amount: 100n,
        discountRate: 300,
        dueDate: NOW + 5 * 86_400_000,
        token: 'USDC_CONTRACT_ID',
      }),
      makeInvoice({
        payer: 'GPAYER_A',
        amount: 100n,
        discountRate: 200,
        dueDate: NOW + 20 * 86_400_000,
        token: 'USDC_CONTRACT_ID',
      }),
      makeInvoice({
        payer: 'GPAYER_B',
        amount: 50n,
        discountRate: 400,
        dueDate: NOW + 40 * 86_400_000,
        token: 'EURC_CONTRACT_ID',
      }),
      makeInvoice({
        payer: 'GPAYER_C',
        amount: 50n,
        discountRate: 500,
        dueDate: NOW + 120 * 86_400_000,
        token: 'XLM',
      }),
    ];

    const metrics = calculateLPRiskMetrics({
      address: ADDRESS,
      invoices,
      portfolio,
      reputationByPayer: new Map([
        ['GPAYER_A', 80],
        ['GPAYER_B', 40],
        ['GPAYER_C', 20],
      ]),
      now: NOW,
      simulations: 2000,
    });

    expect(metrics.totalPositions).toBe(4);
    expect(metrics.totalExposure).toBe(300n);
    expect(metrics.herdRisk).toBe(true);
    expect(metrics.herdShare).toBeCloseTo(2 / 3, 5);
    expect(metrics.herfindahlHirschmanIndex).toBeCloseTo(5000, 0);
    expect(metrics.giniCoefficient).toBeCloseTo(1 / 6, 3);
    expect(metrics.defaultProbabilityEstimate).toBeCloseTo(0.1708333333, 4);
    expect(metrics.expectedLoss).toBe(51n);
    expect(metrics.expectedYield).toBe(10n);
    expect(metrics.valueAtRisk95).toBeGreaterThanOrEqual(100n);
    expect(metrics.valueAtRisk95).toBeLessThanOrEqual(300n);
    expect(metrics.sharpeRatio).toBeGreaterThan(0.5);
    expect(metrics.sharpeRatio).toBeLessThan(2);

    expect(metrics.payerExposure[0]).toMatchObject({
      payer: 'GPAYER_A',
      positionCount: 2,
    });
    expect(metrics.tokenDiversification.map((entry) => entry.token)).toEqual([
      'USDC',
      'EURC',
      'XLM',
    ]);
    expect(metrics.maturityProfile.map((entry) => entry.label)).toEqual([
      '0-7d',
      '7-30d',
      '30-90d',
      '90d+',
    ]);
  });

  it('returns empty metrics when no positions are available', () => {
    const metrics = calculateLPRiskMetrics({
      address: ADDRESS,
      invoices: [],
      portfolio,
      now: NOW,
    });

    expect(metrics.totalPositions).toBe(0);
    expect(metrics.totalExposure).toBe(0n);
    expect(metrics.payerExposure).toEqual([]);
    expect(metrics.tokenDiversification).toEqual([]);
    expect(metrics.valueAtRisk95).toBe(0n);
    expect(metrics.yieldAdjustedRiskScore).toBe(0);
  });
});

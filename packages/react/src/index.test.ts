import { describe, it, expect } from 'vitest';
import * as exports from './index';

describe('package exports', () => {
  it('exports all hooks', () => {
    expect(exports.useILN).toBeDefined();
    expect(exports.useInvoice).toBeDefined();
    expect(exports.useInvoices).toBeDefined();
    expect(exports.useInvoiceList).toBeDefined();
    expect(exports.useSubmitInvoice).toBeDefined();
    expect(exports.useFundInvoice).toBeDefined();
    expect(exports.useReputationScore).toBeDefined();
    expect(exports.useLPPortfolio).toBeDefined();
    expect(exports.useLPRiskMetrics).toBeDefined();
    expect(exports.useContractStats).toBeDefined();
    expect(exports.useGovernanceProposal).toBeDefined();
    expect(exports.useTokenBalances).toBeDefined();
  });

  it('exports provider and context utilities', () => {
    expect(exports.ILNProvider).toBeDefined();
    expect(exports.useILNClient).toBeDefined();
    expect(exports.ILNContext).toBeDefined();
    expect(exports.ILNProviderNotFoundError).toBeDefined();
  });

  it('exports all components', () => {
    expect(exports.NotificationCenter).toBeDefined();
    expect(exports.StatsCard).toBeDefined();
    expect(exports.ResponsiveGrid).toBeDefined();
    expect(exports.InvoiceList).toBeDefined();
    expect(exports.YieldDisplay).toBeDefined();
    expect(exports.PortfolioChart).toBeDefined();
    expect(exports.LPRiskDashboard).toBeDefined();
  });

  it('exports all types', () => {
    // Type-only exports are erased at runtime, but we can verify the module loads
    expect(exports).toBeDefined();
  });
});

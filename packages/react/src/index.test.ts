import { describe, it, expect } from 'vitest';
import * as exports from './index';

describe('package exports', () => {
  it('exports all hooks', () => {
    expect(exports.useInvoice).toBeDefined();
    expect(exports.useInvoiceList).toBeDefined();
    expect(exports.useReputationScore).toBeDefined();
    expect(exports.useLPPortfolio).toBeDefined();
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

  it('exports all types', () => {
    // Type-only exports are erased at runtime, but we can verify the module loads
    expect(exports).toBeDefined();
  });
});
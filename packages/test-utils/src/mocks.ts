import { vi } from 'vitest';
import type {
  ILNClient,
  Invoice,
  ReputationScore,
  LPPortfolio,
  ContractStats,
  GovernanceProposal,
} from '@iln/sdk';
import {
  createInvoice,
  createReputationScore,
  createGovernanceProposal,
  createLPStats,
  createContractStats,
} from './factories';

/** A mock ILNClient backed by factory-generated data. All methods are vitest spies. */
export function createMockILNClient(overrides: Partial<ILNClient> = {}): ILNClient {
  const invoice = createInvoice();
  const invoices = [createInvoice(), createInvoice()];

  return {
    getInvoice: vi.fn().mockResolvedValue(invoice),
    getInvoicesByIssuer: vi.fn().mockResolvedValue(invoices),
    getInvoicesByStatus: vi.fn().mockResolvedValue(invoices),
    getReputationScore: vi.fn().mockResolvedValue(createReputationScore()),
    getLPPortfolio: vi.fn().mockResolvedValue(createLPStats()),
    getContractStats: vi.fn().mockResolvedValue(createContractStats()),
    getProposal: vi.fn().mockResolvedValue(createGovernanceProposal()),
    getTokenBalances: vi.fn().mockResolvedValue([]),
    submitInvoice: vi.fn().mockResolvedValue(invoice.id),
    fundInvoice: vi.fn().mockResolvedValue(undefined),
    markPaid: vi.fn().mockResolvedValue(undefined),
    createProposal: vi.fn().mockResolvedValue(undefined),
    vote: vi.fn().mockResolvedValue(undefined),
    connectWallet: vi
      .fn()
      .mockResolvedValue('GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2'),
    ...overrides,
  } as unknown as ILNClient;
}

/** Returns a fixed invoice for snapshot / deterministic tests. */
export const MOCK_INVOICE: Partial<Invoice> = {
  id: 1n as any,
  freelancer: 'GFREE00000000000000000000000000000000000000000000000000',
  payer: 'GPAYER0000000000000000000000000000000000000000000000000',
  amount: 100_000_000n as any,
  dueDate: 1_800_000_000 as any,
  discountRate: 300,
  status: 'Pending' as any,
  funder: null as any,
  fundedAt: null as any,
};

export const MOCK_LP_STATS = createLPStats({
  address: 'GLPADDR00000000000000000000000000000000000000000000000',
  invoiceCount: 10,
});

export const MOCK_CONTRACT_STATS = createContractStats({
  totalInvoices: 500,
  defaultRate: 0.02,
});

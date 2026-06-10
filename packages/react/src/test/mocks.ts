import type { ILNClient, Invoice, InvoiceStatus, Proposal, ReputationScore, LPPortfolio, ContractStats, TokenBalance } from '@invoice-liquidity/sdk';

export const mockInvoice: Invoice = {
  id: 42,
  issuer: 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2',
  payer: 'GDELEGATE_ADDRESS',
  amount: 100_0000000,
  discountRate: 300,
  dueDate: 1735689600,
  status: InvoiceStatus.Funded,
  fundedBy: 'G_LP_ADDRESS',
  token: 'USDC_CONTRACT_ID',
};

export const mockInvoiceList: Invoice[] = [
  mockInvoice,
  {
    ...mockInvoice,
    id: 43,
    status: InvoiceStatus.Pending,
    fundedBy: null,
  },
];

export const mockReputationScore: ReputationScore = {
  address: 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2',
  score: 850,
  totalInvoices: 12,
  paidOnTime: 11,
  defaulted: 1,
  avgDiscountRate: 250,
};

export const mockLPPortfolio: LPPortfolio = {
  address: 'G_LP_ADDRESS',
  totalInvested: 5000_0000000,
  totalYield: 150_0000000,
  activePositions: 5,
  completedPositions: 8,
  defaultedPositions: 1,
  avgReturn: 3.2,
};

export const mockContractStats: ContractStats = {
  totalValueLocked: 1_000_000_0000000,
  totalInvoices: 1523,
  totalVolume: 5_000_000_0000000,
  activeInvoices: 342,
  avgDiscountRate: 280,
};

export const mockProposal: Proposal = {
  id: 1,
  proposer: 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2',
  parameter: 'MinInvoiceAmount',
  newValue: 50_0000000,
  votesFor: 10_000_0000000,
  votesAgainst: 2_000_0000000,
  deadline: 1738368000,
  executed: false,
};

export const mockTokenBalances: TokenBalance[] = [
  { token: 'USDC', contractId: 'USDC_ID', balance: 1000_0000000 },
  { token: 'EURC', contractId: 'EURC_ID', balance: 500_0000000 },
  { token: 'XLM', contractId: 'XLM_ID', balance: 50_0000000 },
];

export function createMockILNClient(overrides: Partial<ILNClient> = {}): ILNClient {
  return {
    getInvoice: vi.fn().mockResolvedValue(mockInvoice),
    getInvoicesByIssuer: vi.fn().mockResolvedValue(mockInvoiceList),
    getInvoicesByStatus: vi.fn().mockResolvedValue(mockInvoiceList),
    getReputationScore: vi.fn().mockResolvedValue(mockReputationScore),
    getLPPortfolio: vi.fn().mockResolvedValue(mockLPPortfolio),
    getContractStats: vi.fn().mockResolvedValue(mockContractStats),
    getProposal: vi.fn().mockResolvedValue(mockProposal),
    getTokenBalances: vi.fn().mockResolvedValue(mockTokenBalances),
    submitInvoice: vi.fn(),
    fundInvoice: vi.fn(),
    markPaid: vi.fn(),
    createProposal: vi.fn(),
    vote: vi.fn(),
    connectWallet: vi.fn(),
    ...overrides,
  } as unknown as ILNClient;
}
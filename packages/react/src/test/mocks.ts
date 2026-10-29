import { vi } from 'vitest';
import type {
  ILNClient,
  Invoice,
  Proposal,
  ReputationScore,
  LPPortfolio,
  ContractStats,
  TokenBalance,
} from '@iln/sdk';

export const mockInvoice: Invoice = {
  id: 42,
  issuer: 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2',
  payer: 'GDELEGATE_ADDRESS',
  amount: 100_0000000,
  discountRate: 300,
  dueDate: 1735689600,
  status: 'Funded',
  fundedBy: 'G_LP_ADDRESS',
  token: 'USDC_CONTRACT_ID',
} as unknown as Invoice;

export const mockInvoiceList: Invoice[] = [
  mockInvoice,
  {
    ...mockInvoice,
    id: 43,
    status: 'Pending',
    fundedBy: null,
  } as unknown as Invoice,
];

export const mockReputationScore: ReputationScore = {
  address: 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2',
  score: 850,
  totalInvoices: 12,
  paidOnTime: 11,
  defaulted: 1,
  avgDiscountRate: 250,
} as unknown as ReputationScore;

export const mockLPPortfolio: LPPortfolio = {
  address: 'G_LP_ADDRESS',
  totalInvested: 5000_0000000,
  totalYield: 150_0000000,
  activePositions: 5,
  completedPositions: 8,
  defaultedPositions: 1,
  avgReturn: 3.2,
} as unknown as LPPortfolio;

export const mockContractStats: ContractStats = {
  totalValueLocked: 1_000_000_0000000,
  totalInvoices: 1523,
  totalVolume: 5_000_000_0000000,
  activeInvoices: 342,
  avgDiscountRate: 280,
} as unknown as ContractStats;

export const mockProposal: Proposal = {
  id: 1,
  proposer: 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2',
  parameter: 'MinInvoiceAmount',
  newValue: 50_0000000,
  votesFor: 10_000_0000000,
  votesAgainst: 2_000_0000000,
  deadline: 1738368000,
  executed: false,
} as unknown as Proposal;

export const mockTokenBalances: TokenBalance[] = [
  { token: 'USDC', contractId: 'USDC_ID', balance: 1000_0000000 },
  { token: 'EURC', contractId: 'EURC_ID', balance: 500_0000000 },
  { token: 'XLM', contractId: 'XLM_ID', balance: 50_0000000 },
] as unknown as TokenBalance[];

export const mockLPCoverage = {
  address: 'GLPADDR00000000000000000000000000000000000000000000000',
  enrolledAt: 1735689600,
  coverageAmount: 10_000_000_000n,
  premiumRateBps: 500,
  totalPremiumsPaid: 500_000_000n,
  activeClaims: 1,
  totalClaims: 2,
  claimsApproved: 1,
  claimsRejected: 0,
  totalPayoutReceived: 5_000_000_000n,
} as unknown as import('@iln/sdk').LPCoverage;

export const mockInsuranceClaim = {
  id: 1n,
  lp: 'GLPADDR00000000000000000000000000000000000000000000000',
  invoiceId: 42n,
  invoiceAmount: 5_000_000_000n,
  reason: 'Payer defaulted on invoice',
  status: 'Pending',
  filedAt: 1735776000,
  reviewedAt: null,
  reviewer: null,
  rejectionReason: null,
  payoutAmount: null,
} as unknown as import('@iln/sdk').InsuranceClaim;

export const mockPoolBalance = {
  totalPremiums: 10_000_000_000n,
  totalPayouts: 3_000_000_000n,
  reserveBalance: 7_000_000_000n,
  enrolledLps: 5,
  activeClaims: 3,
  pendingClaims: 2,
  approvedClaims: 1,
  rejectedClaims: 0,
} as unknown as import('@iln/sdk').PoolBalance;

export const mockDisputeRecord = {
  invoiceId: 101n,
  disputer: 'GPAYER123',
  reasonCategory: 'quality',
  reasonDescription: 'Work deliverable does not match specifications.',
  evidenceCid: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
  evidence: [
    {
      id: 'ev-1',
      submitter: 'GPAYER123',
      role: 'payer',
      evidenceCid: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      description: 'Initial claim with specs sheet.',
      submittedAt: 1735776000,
    },
  ],
  filedAt: 1735776000,
  evidenceDeadline: 1736380800,
  autoResolveAt: 1736380800,
  status: 'Pending',
  resolvedAt: null,
  resolvedBy: null,
  resolutionDecision: null,
  resolutionNotes: null,
};

export const mockDisputeAnalytics = {
  totalDisputes: 4,
  disputeRateByPayer: { GPAYER123: 0.2 },
  averageResolutionTimeSeconds: 86400,
  winRateByParty: { payer: 0.5, freelancer: 0.5 },
  commonDisputeReasons: { quality: 2, timing: 1, amount: 1, other: 0 },
};

export function createMockILNClient(overrides: Partial<Record<string, unknown>> = {}): ILNClient {
  return {
    getInvoice: vi.fn().mockResolvedValue(mockInvoice),
    getInvoicesByIssuer: vi.fn().mockResolvedValue(mockInvoiceList),
    getInvoicesByStatus: vi.fn().mockResolvedValue(mockInvoiceList),
    getReputationScore: vi.fn().mockResolvedValue(mockReputationScore),
    getLPPortfolio: vi.fn().mockResolvedValue(mockLPPortfolio),
    getContractStats: vi.fn().mockResolvedValue(mockContractStats),
    getProposal: vi.fn().mockResolvedValue(mockProposal),
    getLatestLedger: vi.fn().mockResolvedValue(100n),
    getTokenBalances: vi.fn().mockResolvedValue(mockTokenBalances),
    submitInvoice: vi.fn().mockResolvedValue(42),
    fundInvoice: vi.fn().mockResolvedValue(undefined),
    markPaid: vi.fn().mockResolvedValue(undefined),
    createProposal: vi.fn().mockResolvedValue(undefined),
    vote: vi.fn().mockResolvedValue(undefined),
    connectWallet: vi
      .fn()
      .mockResolvedValue('GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2'),
    getLPCoverage: vi.fn().mockResolvedValue(mockLPCoverage),
    getPoolBalance: vi.fn().mockResolvedValue(mockPoolBalance),
    getClaim: vi.fn().mockResolvedValue(mockInsuranceClaim),
    listClaims: vi.fn().mockResolvedValue([mockInsuranceClaim]),
    enroll: vi.fn().mockResolvedValue(undefined),
    depositPremium: vi.fn().mockResolvedValue(undefined),
    submitClaim: vi.fn().mockResolvedValue(2n),
    reviewClaim: vi.fn().mockResolvedValue(undefined),
    getDispute: vi.fn().mockResolvedValue(mockDisputeRecord),
    listDisputes: vi.fn().mockResolvedValue([mockDisputeRecord]),
    disputeInvoice: vi.fn().mockResolvedValue({ txHash: 'tx-hash-dispute' }),
    submitDisputeEvidence: vi.fn().mockResolvedValue({ txHash: 'tx-hash-evidence' }),
    resolveDispute: vi.fn().mockResolvedValue({ txHash: 'tx-hash-resolve' }),
    autoResolveDispute: vi.fn().mockResolvedValue({ txHash: 'tx-hash-auto' }),
    getDisputeAnalytics: vi.fn().mockResolvedValue(mockDisputeAnalytics),
    ...overrides,
  } as unknown as ILNClient;
}

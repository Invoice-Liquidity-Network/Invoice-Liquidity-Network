// ─── Invoice types ────────────────────────────────────────────────────────────

export type InvoiceStatus = "Pending" | "Funded" | "Paid" | "Defaulted" | "Cancelled" | "Expired";

export interface Invoice {
  id: bigint;
  freelancer: string;
  payer: string;
  amount: bigint;
  /** Unix timestamp (seconds) */
  due_date: bigint;
  discount_rate: number;
  status: InvoiceStatus;
  funder: string | null;
  funded_at: bigint | null;
  /** Token contract ID */
  token: string;
}

export interface SubmitInvoiceArgs {
  freelancer: string;
  payer: string;
  /** Amount in stroops (1 USDC = 10_000_000) */
  amount: bigint;
  /** Unix timestamp (seconds) */
  dueDate: number;
  /** Basis-points — e.g. 500 = 5.00% */
  discountRate: number;
  token?: string;
}

export interface SubmittedInvoiceResult {
  invoiceId: bigint;
  /** Simulated transaction hash */
  txHash: string;
}

export interface UpdateInvoiceArgs {
  freelancer: string;
  invoiceId: bigint;
  amount: bigint;
  dueDate: number;
  discountRate: number;
}

// ─── Reputation types ─────────────────────────────────────────────────────────

export interface PayerScore {
  /** Composite score from 0–100 */
  score: number;
  settled_on_time: number;
  defaults: number;
}

// ─── Token types ──────────────────────────────────────────────────────────────

export interface TokenMetadata {
  contractId: string;
  name: string;
  symbol: string;
  decimals: number;
}

// ─── Governance types ─────────────────────────────────────────────────────────

export type ProposalType = "ParameterUpdate" | "ProtocolUpgrade" | "TextProposal";
export type ProposalStatus = "Active" | "Passed" | "Failed" | "Executed" | "Pending";
export type VoteChoice = "For" | "Against" | "Abstain";

export interface ParameterChange {
  parameter: string;
  currentValue: string;
  newValue: string;
}

export interface Proposal {
  id: number;
  title: string;
  description: string;
  type: ProposalType;
  status: ProposalStatus;
  proposer: string;
  createdAt: number;
  votingStartsAt: number;
  votingEndsAt: number;
  executableAfter?: number;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  quorumRequired: number;
  parameterChanges?: ParameterChange[];
  userVote?: VoteChoice;
}

export interface ProtocolParameters {
  feeRateBps: number;
  maxDiscountRateBps: number;
  acceptedTokens: Array<{ address: string; name: string; symbol: string }>;
  minProposalILN: number;
}

export interface CreateProposalPayload {
  title: string;
  description: string;
  type: ProposalType;
  parameterChanges?: ParameterChange[];
}

// ─── Client interfaces ────────────────────────────────────────────────────────

/**
 * Interface that mirrors all read/write operations performed via soroban.ts
 * in the frontend. The mock and the real implementations both satisfy this
 * contract so the frontend can swap them via an env-var flag.
 */
export interface InvoiceClient {
  getInvoiceCount(): Promise<bigint>;
  getInvoice(id: bigint): Promise<Invoice>;
  getAllInvoices(): Promise<Invoice[]>;

  getTokenBalance(address: string, tokenId?: string): Promise<bigint>;
  getTokenAllowance(args: { owner: string; spender?: string; tokenId?: string }): Promise<bigint>;
  getApprovedTokenIds(): Promise<string[]>;
  getTokenMetadata(tokenId: string): Promise<TokenMetadata>;

  getPayerScore(payerAddress: string): Promise<PayerScore | null>;
  getPayerScoresBatch(addresses: string[]): Promise<Map<string, PayerScore | null>>;

  submitInvoice(args: SubmitInvoiceArgs): Promise<SubmittedInvoiceResult>;
  fundInvoice(funder: string, invoiceId: bigint): Promise<{ txHash: string }>;
  markPaid(payer: string, invoiceId: bigint): Promise<{ txHash: string }>;
  claimDefault(funder: string, invoiceId: bigint): Promise<{ txHash: string }>;
  cancelInvoice(freelancer: string, invoiceId: bigint): Promise<{ txHash: string }>;
  updateInvoice(args: UpdateInvoiceArgs): Promise<{ txHash: string }>;
  approveToken(args: { owner: string; amount: bigint; spender?: string; tokenId?: string }): Promise<{ txHash: string }>;
}

export interface ReputationClient {
  getPayerScore(payerAddress: string): Promise<PayerScore | null>;
  getPayerScoresBatch(addresses: string[]): Promise<Map<string, PayerScore | null>>;
}

export interface GovernanceClient {
  fetchProposals(): Promise<Proposal[]>;
  fetchProposal(id: number): Promise<Proposal | null>;
  castVote(proposalId: number, choice: VoteChoice, signerAddress: string): Promise<string>;
  executeProposal(proposalId: number, signerAddress: string): Promise<string>;
  getVotingPower(address: string): Promise<number>;
  fetchProtocolParameters(): Promise<ProtocolParameters>;
  createProposal(payload: CreateProposalPayload, signerAddress: string): Promise<{ txHash: string; proposalId: number }>;
}

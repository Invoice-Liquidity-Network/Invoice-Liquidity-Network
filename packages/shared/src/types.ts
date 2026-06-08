export type InvoiceState = "Pending" | "Funded" | "Paid" | "Defaulted";

export interface Invoice {
  id: bigint;
  freelancer: string;
  payer: string;
  amount: bigint;
  dueDate: number;
  discountRate: number;
  status: InvoiceState;
  funder: string | null;
  fundedAt: number | null;
}

export interface ReputationScore {
  address: string;
  score: number;
  updatedAt: number;
}

export type ProposalStatus =
  | "Draft"
  | "Active"
  | "Succeeded"
  | "Defeated"
  | "Executed"
  | "Cancelled";

export interface GovernanceProposal {
  id: bigint;
  proposer: string;
  title: string;
  description: string;
  status: ProposalStatus;
  createdAt: number;
  votingEndsAt: number;
  executedAt: number | null;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
}

export interface Token {
  contractId: string;
  symbol: string;
  name: string;
  decimals: number;
  issuer: string | null;
  listed: boolean;
}

export interface ContractStats {
  totalInvoices: number;
  totalVolume: bigint;
  totalYield: bigint;
  defaultRate: number;
}

export interface LPStats {
  deployed: bigint;
  yield: bigint;
  invoiceCount: number;
  defaultRate: number;
}

interface ContractEventBase {
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  pagingToken: string;
}

export interface InvoiceCreatedEvent extends ContractEventBase {
  type: "InvoiceCreated";
  invoice: Invoice;
}

export interface InvoiceFundedEvent extends ContractEventBase {
  type: "InvoiceFunded";
  invoiceId: bigint;
  funder: string;
  amount: bigint;
}

export interface InvoiceRepaidEvent extends ContractEventBase {
  type: "InvoiceRepaid";
  invoiceId: bigint;
  payer: string;
  amount: bigint;
}

export interface InvoiceDefaultedEvent extends ContractEventBase {
  type: "InvoiceDefaulted";
  invoiceId: bigint;
  funder: string | null;
  amountRecovered: bigint;
}

export interface GovernanceProposalCreatedEvent extends ContractEventBase {
  type: "ProposalCreated";
  proposal: GovernanceProposal;
}

export interface GovernanceProposalVotedEvent extends ContractEventBase {
  type: "ProposalVoted";
  proposalId: bigint;
  voter: string;
  support: boolean;
  weight: bigint;
}

export interface GovernanceProposalExecutedEvent extends ContractEventBase {
  type: "ProposalExecuted";
  proposalId: bigint;
  executor: string;
}

export interface TokenListedEvent extends ContractEventBase {
  type: "TokenListed";
  token: Token;
}

export interface TokenDelistedEvent extends ContractEventBase {
  type: "TokenDelisted";
  token: Token;
}

export interface ReputationUpdatedEvent extends ContractEventBase {
  type: "ReputationUpdated";
  reputation: ReputationScore;
}

export interface ContractStatsUpdatedEvent extends ContractEventBase {
  type: "ContractStatsUpdated";
  stats: ContractStats;
}

export interface LPStatsUpdatedEvent extends ContractEventBase {
  type: "LPStatsUpdated";
  address: string;
  stats: LPStats;
}

export type ContractEvent =
  | InvoiceCreatedEvent
  | InvoiceFundedEvent
  | InvoiceRepaidEvent
  | InvoiceDefaultedEvent
  | GovernanceProposalCreatedEvent
  | GovernanceProposalVotedEvent
  | GovernanceProposalExecutedEvent
  | TokenListedEvent
  | TokenDelistedEvent
  | ReputationUpdatedEvent
  | ContractStatsUpdatedEvent
  | LPStatsUpdatedEvent;

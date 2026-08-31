/**
 * @iln/shared — canonical TypeScript types for the Invoice Liquidity Network.
 *
 * Every type in this file is derived directly from the Soroban contract structs
 * and enums documented in docs/contracts/. Field names use camelCase equivalents
 * of the contract's snake_case names. Contract source types are noted inline so
 * drift can be caught immediately at review time.
 *
 * DO NOT add or remove fields here without updating docs/contracts/ first.
 * An automated generation approach is documented in docs/contracts/README.md
 * and scaffolded in scripts/generate-shared-types.mts.
 *
 * Last audited against: docs/contracts/ (invoice-contract.md v1.0,
 * governance-contract.md v1.0, reputation-contract.md v1.0)
 */

// =============================================================================
// Invoice Status
// contract: InvoiceStatus enum (invoice-contract.md#invoice-status)
// =============================================================================

/**
 * All nine on-chain invoice states.
 *
 * Terminal states (no further transitions): Paid, Defaulted, Expired, Cancelled.
 * Non-terminal: Pending, PartiallyFunded, Funded, Appealed, Disputed.
 */
export type InvoiceStatus =
  | 'Pending' // Submitted, awaiting LP funding
  | 'PartiallyFunded' // One or more LPs contributed; not yet fully funded
  | 'Funded' // Fully funded; awaiting payer settlement
  | 'Paid' // Payer settled — TERMINAL
  | 'Defaulted' // Due date passed, payer did not settle — TERMINAL
  | 'Appealed' // Payer appealed a default; admin review pending
  | 'Disputed' // Payer disputed before settlement; admin review pending
  | 'Expired' // Never funded and due date passed — TERMINAL
  | 'Cancelled'; // Submitter cancelled a Pending invoice — TERMINAL

/**
 * @deprecated Use InvoiceStatus instead.
 * Kept for backward compatibility — previously this type was exported as
 * InvoiceState and only covered 4 of the 9 contract statuses.
 */
export type InvoiceState = InvoiceStatus;

// =============================================================================
// Invoice
// contract: Invoice struct (invoice-contract.md#invoice-structure)
// =============================================================================

export interface Invoice {
  /** contract: id u64 */
  id: bigint;
  /** contract: freelancer Address — payout recipient */
  freelancer: string;
  /** contract: payer Address — settlement obligor */
  payer: string;
  /** contract: token Address — payment token (USDC, XLM, or EURC) */
  token: string;
  /** contract: amount i128 — invoice face value in token's smallest unit */
  amount: bigint;
  /** contract: due_date u32 — Unix timestamp by which payer must settle */
  dueDate: number;
  /** contract: discount_rate u32 — LP yield in basis points (e.g. 300 = 3%) */
  discountRate: number;
  /** contract: status InvoiceStatus */
  status: InvoiceStatus;
  /** contract: funder Option<Address> — primary LP; null until first funding */
  funder: string | null;
  /** contract: funded_at Option<u32> — Unix timestamp when fully funded */
  fundedAt: number | null;
  /** contract: amount_funded i128 — cumulative capital deployed by LPs */
  amountFunded: bigint;
  /** contract: amount_paid i128 — cumulative payer payments received */
  amountPaid: bigint;
  /** contract: submitter_reputation u32 — freelancer's reputation score snapshot at submission */
  submitterReputation: number;
  /** contract: referral_code Option<BytesN<32>> — optional referral tracking hash */
  referralCode: Uint8Array | null;
  /** contract: allowed_lps Option<Vec<Address>> — LP whitelist (max 10); null means open */
  allowedLps: string[] | null;
  /** contract: is_auction bool — true if this invoice uses Dutch auction funding */
  isAuction: boolean;
  /** contract: auction_start_rate Option<u32> — initial discount rate for auction (bps) */
  auctionStartRate: number | null;
  /** contract: auction_min_rate Option<u32> — floor discount rate for auction (bps) */
  auctionMinRate: number | null;
  /** contract: auction_rate_decay_per_hour Option<u32> — bps decay per hour */
  auctionRateDecayPerHour: number | null;
  /** contract: auction_started_at Option<u32> — Unix timestamp when auction began */
  auctionStartedAt: number | null;
}

// =============================================================================
// Reputation
// contract: ReputationScore (reputation-contract.md#reputationscore)
//           ReputationProfile (invoice-contract.md#reputationprofile)
// =============================================================================

export interface ReputationScore {
  /** contract: address Address */
  address: string;
  /**
   * contract: score u32 (reputation-contract) / payer_score u32 (invoice-contract)
   * Range 0-100+; can exceed 100 for highly reliable accounts. Decays over time.
   */
  score: number;
  /** contract: invoices_submitted u64 — lifetime invoice submission count */
  invoicesSubmitted: bigint;
  /** contract: invoices_paid u64 — on-time settlement count */
  invoicesPaid: bigint;
  /** contract: invoices_defaulted u64 — default count (incurs score penalty) */
  invoicesDefaulted: bigint;
  /**
   * contract: last_activity_ledger u64 — ledger sequence of last score update.
   * Use this to assess score freshness; scores decay since last activity.
   */
  lastActivityLedger: bigint;
}

// =============================================================================
// Governance — ProposalStatus
// contract: ProposalStatus enum (governance-contract.md#proposalstatus)
// =============================================================================

export type ProposalStatus =
  | 'Active' // Voting period ongoing
  | 'Passed' // Voting complete, quorum and majority met; awaiting timelock
  | 'Rejected' // Quorum not met or minority vote — TERMINAL
  | 'Executed' // Successfully executed after timelock — TERMINAL
  | 'Vetoed'; // Blocked by admin veto — TERMINAL

// =============================================================================
// Governance — ProposalAction
// contract: ProposalAction enum (governance-contract.md#proposalaction)
// =============================================================================

/** Discriminated union of the four on-chain governance action variants. */
export type ProposalAction =
  | { type: 'UpdateFeeRate'; value: number } // u32 bps
  | { type: 'AddToken'; value: string } // Address
  | { type: 'RemoveToken'; value: string } // Address
  | { type: 'UpdateMaxDiscountRate'; value: number }; // u32 bps

// =============================================================================
// Governance — GovernanceProposal
// contract: GovernanceProposal struct (governance-contract.md#governanceproposal)
// =============================================================================

export interface GovernanceProposal {
  /** contract: id u64 */
  id: bigint;
  /** contract: proposer Address */
  proposer: string;
  /**
   * contract: description_hash BytesN<32>
   * SHA-256 hash of the off-chain proposal description/rationale.
   * The full text is stored off-chain; only the hash is on-chain.
   */
  descriptionHash: Uint8Array;
  /** contract: action_type ProposalAction */
  actionType: ProposalAction;
  /** contract: proposed_value i128 — numeric value for the action (0 for address actions) */
  proposedValue: bigint;
  /** contract: status ProposalStatus */
  status: ProposalStatus;
  /** contract: votes_for i128 — cumulative weight voting for */
  votesFor: bigint;
  /** contract: votes_against i128 — cumulative weight voting against */
  votesAgainst: bigint;
  /** contract: created_at u64 — Unix timestamp of proposal creation */
  createdAt: number;
  /**
   * contract: voting_end u64 — Unix timestamp when voting closes.
   * Voting period is 3 days (~259,200 seconds) from creation.
   */
  votingEndsAt: number;
  /**
   * contract: eta_ledger u32 — ledger sequence after which execution is allowed.
   * Derived from the timelock delay. Null until proposal reaches Passed status.
   */
  etaLedger: number | null;
}

// =============================================================================
// Token
// NOTE: Token is a client-side convenience type, not a contract struct.
// The contract manages tokens via add_token(Address)/remove_token(Address);
// metadata (symbol, name, decimals) is read from the token's own SAC contract.
// =============================================================================

export interface Token {
  /** Stellar Asset Contract address of the token */
  contractId: string;
  /** Token symbol, e.g. "USDC" */
  symbol: string;
  /** Full token name, e.g. "USD Coin" */
  name: string;
  /** Decimal places (7 for Stellar-native tokens) */
  decimals: number;
  /** Issuing account address; null for XLM (native asset) */
  issuer: string | null;
  /** Whether this token is currently approved on the ILN contract */
  listed: boolean;
}

// =============================================================================
// ContractStats
// contract: return value of get_contract_stats() (invoice-contract.md#get_contract_stats)
// =============================================================================

export interface ContractStats {
  /** contract: total_invoices u64 — all-time invoice submission count */
  totalInvoices: bigint;
  /** contract: total_funded u64 — all-time fully-funded invoice count */
  totalFunded: bigint;
  /** contract: total_paid u64 — all-time settled invoice count */
  totalPaid: bigint;
  /** contract: total_volume i128 — cumulative funding volume across all tokens (smallest unit) */
  totalVolume: bigint;
}

// =============================================================================
// LPStats
// contract: LPStats struct (invoice-contract.md#lpstats)
// =============================================================================

export interface LPStats {
  /** contract: total_funded i128 — cumulative capital deployed (smallest unit) */
  totalFunded: bigint;
  /** contract: total_earned i128 — cumulative yield received (smallest unit) */
  totalEarned: bigint;
  /** contract: active_positions u64 — invoices currently in Funded status */
  activePositions: bigint;
  /** contract: total_positions u64 — all-time funded invoice count */
  totalPositions: bigint;
  /** contract: avg_yield_bps u32 — running average discount rate in basis points */
  avgYieldBps: number;
}

// =============================================================================
// Contract Events
// contract: Event Schema (invoice-contract.md#event-schema, governance-contract.md)
// =============================================================================

interface ContractEventBase {
  /** Stellar Asset Contract address that emitted the event */
  contractId: string;
  /** Soroban ledger sequence number */
  ledger: number;
  /** ISO-8601 timestamp of ledger close */
  ledgerClosedAt: string;
  /** Transaction hash */
  txHash: string;
  /** Paging token for cursor-based pagination */
  pagingToken: string;
}

/** contract event: InvoiceSubmitted */
export interface InvoiceSubmittedEvent extends ContractEventBase {
  type: 'InvoiceSubmitted';
  invoice: Invoice;
}

/**
 * @deprecated Use InvoiceSubmittedEvent.
 * The contract emits "InvoiceSubmitted", not "InvoiceCreated".
 * This alias is kept for consumers that adopted the old name.
 */
export type InvoiceCreatedEvent = Omit<InvoiceSubmittedEvent, 'type'> & {
  type: 'InvoiceCreated';
};

/** contract event: InvoiceFunded (invoice-contract.md#event-schema) */
export interface InvoiceFundedEvent extends ContractEventBase {
  type: 'InvoiceFunded';
  invoiceId: bigint;
  /** LP that contributed capital */
  funder: string;
  /** Capital contributed in this funding call (smallest unit) */
  amount: bigint;
  /** Cumulative funded amount after this call */
  amountFunded: bigint;
  /** Effective yield rate applied at funding time (bps) */
  effectiveYieldBps: number;
  status: InvoiceStatus;
}

/** contract event: InvoicePaid (invoice-contract.md#event-schema) */
export interface InvoicePaidEvent extends ContractEventBase {
  type: 'InvoicePaid';
  invoiceId: bigint;
  payer: string;
  /** Total amount paid by payer */
  amount: bigint;
  /** Amount the LP earned (the discount) */
  lpEarned: bigint;
  /** Total payout to LP (principal + yield) */
  lpPayout: bigint;
}

/**
 * @deprecated Use InvoicePaidEvent.
 * The contract emits "InvoicePaid", not "InvoiceRepaid".
 */
export type InvoiceRepaidEvent = Omit<InvoicePaidEvent, 'type'> & {
  type: 'InvoiceRepaid';
};

/** contract event: InvoiceDefaulted (invoice-contract.md#event-schema) */
export interface InvoiceDefaultedEvent extends ContractEventBase {
  type: 'InvoiceDefaulted';
  invoiceId: bigint;
  funder: string | null;
  amountRecovered: bigint;
}

/** contract event: ProposalCreated (governance-contract.md#event-schema) */
export interface GovernanceProposalCreatedEvent extends ContractEventBase {
  type: 'ProposalCreated';
  proposal: GovernanceProposal;
}

/** contract event: VoteCast (governance-contract.md#cast_vote) */
export interface VoteCastEvent extends ContractEventBase {
  type: 'VoteCast';
  proposalId: bigint;
  voter: string;
  /** true = vote for, false = vote against */
  support: boolean;
  /** Voting weight (own balance + delegated weight) */
  weight: bigint;
}

/**
 * @deprecated Use VoteCastEvent.
 * The contract emits "VoteCast", not "ProposalVoted".
 */
export type GovernanceProposalVotedEvent = Omit<VoteCastEvent, 'type'> & {
  type: 'ProposalVoted';
};

/** contract event: ProposalExecuted (governance-contract.md#execute_proposal) */
export interface GovernanceProposalExecutedEvent extends ContractEventBase {
  type: 'ProposalExecuted';
  proposalId: bigint;
  executor: string;
}

/** contract event: TokenAdded (invoice-contract.md#add_token) */
export interface TokenAddedEvent extends ContractEventBase {
  type: 'TokenAdded';
  token: Token;
}

/** contract event: TokenRemoved (invoice-contract.md#remove_token) */
export interface TokenRemovedEvent extends ContractEventBase {
  type: 'TokenRemoved';
  token: Token;
}

/**
 * @deprecated Use TokenAddedEvent.
 * The contract emits "TokenAdded", not "TokenListed".
 */
export type TokenListedEvent = Omit<TokenAddedEvent, 'type'> & {
  type: 'TokenListed';
};

/**
 * @deprecated Use TokenRemovedEvent.
 * The contract emits "TokenRemoved", not "TokenDelisted".
 */
export type TokenDelistedEvent = Omit<TokenRemovedEvent, 'type'> & {
  type: 'TokenDelisted';
};

/** contract event: ReputationUpdated (reputation-contract.md) */
export interface ReputationUpdatedEvent extends ContractEventBase {
  type: 'ReputationUpdated';
  reputation: ReputationScore;
}

/**
 * Not a contract-emitted event. Retained as a client-side utility type
 * for consumers that synthesise stats update notifications locally.
 */
export interface ContractStatsUpdatedEvent extends ContractEventBase {
  type: 'ContractStatsUpdated';
  stats: ContractStats;
}

/**
 * Not a contract-emitted event. Retained as a client-side utility type
 * for consumers that synthesise LP stats update notifications locally.
 */
export interface LPStatsUpdatedEvent extends ContractEventBase {
  type: 'LPStatsUpdated';
  address: string;
  stats: LPStats;
}

/** Union of all known contract event types. */
export type ContractEvent =
  // Invoice events (canonical names)
  | InvoiceSubmittedEvent
  | InvoiceFundedEvent
  | InvoicePaidEvent
  | InvoiceDefaultedEvent
  // Governance events
  | GovernanceProposalCreatedEvent
  | VoteCastEvent
  | GovernanceProposalExecutedEvent
  // Token events (canonical names)
  | TokenAddedEvent
  | TokenRemovedEvent
  // Reputation events
  | ReputationUpdatedEvent
  // Client-side synthetic events (not emitted by contract)
  | ContractStatsUpdatedEvent
  | LPStatsUpdatedEvent;

/**
 * Enumeration of governance proposal action types.
 */
export enum ProposalActionKind {
  /** Update the protocol fee rate. */
  UpdateFeeRate = "UpdateFeeRate",
  /** Add a new token to the protocol. */
  AddToken = "AddToken",
  /** Remove a token from the protocol. */
  RemoveToken = "RemoveToken",
  /** Update the maximum discount rate. */
  UpdateMaxDiscountRate = "UpdateMaxDiscountRate",
}

/**
 * A governance proposal action with its parameters.
 * Discriminated union on the `kind` field.
 *
 * Intentionally differs from @iln/shared's ProposalAction (which uses `type`
 * and `value` fields). This SDK version uses explicit property names
 * (`rate`, `tokenAddress`) for better ergonomics with TypeScript narrowing.
 */
export type ProposalAction =
  | { kind: ProposalActionKind.UpdateFeeRate; rate: number }
  | { kind: ProposalActionKind.AddToken; tokenAddress: string }
  | { kind: ProposalActionKind.RemoveToken; tokenAddress: string }
  | { kind: ProposalActionKind.UpdateMaxDiscountRate; rate: number };

/**
 * Enumeration of governance proposal statuses.
 *
 * Intentionally a TypeScript enum (not a type alias) so SDK consumers get
 * runtime values. Keep in sync with @iln/shared's ProposalStatus.
 */
export enum ProposalStatus {
  Active = "Active",
  Passed = "Passed",
  Rejected = "Rejected",
  Executed = "Executed",
  Vetoed = "Vetoed",
}

/**
 * A governance proposal as returned by the contract.
 *
 * Intentionally differs from @iln/shared's GovernanceProposal:
 * - `descriptionHash` is `Buffer` (not `Uint8Array`) for Node.js compatibility
 * - `action` uses the SDK's `ProposalAction` (not the shared type alias)
 * - `votingEnd` (not `votingEndsAt`) for brevity
 * - `etaLedger` is non-nullable (defaulted to 0 when unknown)
 */
export interface GovernanceProposal {
  id: bigint;
  proposer: string;
  descriptionHash: Buffer;
  action: ProposalAction;
  proposedValue: bigint;
  status: ProposalStatus;
  votesFor: bigint;
  votesAgainst: bigint;
  createdAt: number;
  votingEnd: number;
  etaLedger: number;
}

/**
 * Parameters for creating a new governance proposal.
 */
export interface CreateProposalParams {
  proposer: string;
  action: ProposalAction;
  descriptionHash: Buffer | Uint8Array;
  proposedValue: bigint;
}

/**
 * Parameters for casting a vote on a governance proposal.
 */
export interface CastVoteParams {
  voter: string;
  proposalId: bigint;
  support: boolean;
}

/**
 * Parameters for executing a passed governance proposal.
 */
export interface ExecuteProposalParams {
  source: string;
  proposalId: bigint;
  totalSupply: bigint;
}

/**
 * Parameters for vetoing a governance proposal.
 */
export interface VetoProposalParams {
  admin: string;
  proposalId: bigint;
  reasonHash: Buffer | Uint8Array;
}

/**
 * Parameters for delegating voting power to another address.
 */
export interface DelegateVotesParams {
  delegator: string;
  delegate: string;
}

/**
 * Parameters for undelegating voting power.
 */
export interface UndelegateVotesParams {
  delegator: string;
}

/**
 * Parameters for fetching a specific governance proposal.
 */
export interface GetProposalParams {
  proposalId: bigint;
}

/**
 * Parameters for listing governance proposals with optional filters.
 */
export interface ListProposalsParams {
  status?: ProposalStatus;
  page?: number;
  pageSize?: number;
}

/**
 * Parameters for computing voting results for a proposal.
 */
export interface GetVotingResultsParams {
  /** The proposal whose votes to tally. */
  proposal: GovernanceProposal;
  /** Total token supply used to compute the quorum threshold. */
  totalSupply: bigint;
  /**
   * Minimum quorum in basis points (e.g. 1000 = 10%).
   * Defaults to `GOVERNANCE_DEFAULT_MIN_QUORUM_BPS` when omitted.
   */
  minQuorumBps?: number;
}

/**
 * Result of tallying votes for a governance proposal.
 */
export interface VotingResult {
  proposalId: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  totalVotes: bigint;
  /** Minimum total-vote count required for quorum (derived from totalSupply and minQuorumBps). */
  quorumThreshold: bigint;
  quorumMet: boolean;
  majorityFor: boolean;
  /** True when both quorum is met and the majority voted for. */
  passed: boolean;
}

/**
 * Configuration for the GovernanceClient.
 */
import type { RpcServerLike } from "./types";

export interface GovernanceClientConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  server?: RpcServerLike;
}

export enum ProposalActionKind {
  UpdateFeeRate = "UpdateFeeRate",
  AddToken = "AddToken",
  RemoveToken = "RemoveToken",
  UpdateMaxDiscountRate = "UpdateMaxDiscountRate",
}

export type ProposalAction =
  | { kind: ProposalActionKind.UpdateFeeRate; rate: number }
  | { kind: ProposalActionKind.AddToken; tokenAddress: string }
  | { kind: ProposalActionKind.RemoveToken; tokenAddress: string }
  | { kind: ProposalActionKind.UpdateMaxDiscountRate; rate: number };

export enum ProposalStatus {
  Active = "Active",
  Passed = "Passed",
  Rejected = "Rejected",
  Executed = "Executed",
  Vetoed = "Vetoed",
}

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

export interface CreateProposalParams {
  proposer: string;
  action: ProposalAction;
  descriptionHash: Buffer | Uint8Array;
  proposedValue: bigint;
}

export interface CastVoteParams {
  voter: string;
  proposalId: bigint;
  support: boolean;
}

export interface ExecuteProposalParams {
  source: string;
  proposalId: bigint;
  totalSupply: bigint;
}

export interface VetoProposalParams {
  admin: string;
  proposalId: bigint;
  reasonHash: Buffer | Uint8Array;
}

export interface DelegateVotesParams {
  delegator: string;
  delegate: string;
}

export interface UndelegateVotesParams {
  delegator: string;
}

export interface GetProposalParams {
  proposalId: bigint;
}

export interface ListProposalsParams {
  status?: ProposalStatus;
  page?: number;
  pageSize?: number;
}

import type { RpcServerLike } from "./types";

export interface GovernanceClientConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  server?: RpcServerLike;
}

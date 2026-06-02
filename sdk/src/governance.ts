import { nativeToScVal, rpc } from "@stellar/stellar-sdk";

import { GovernanceContractMethod } from "./governance-constants";
import type {
  CastVoteParams,
  CreateProposalParams,
  DelegateVotesParams,
  ExecuteProposalParams,
  GetProposalParams,
  GovernanceClientConfig,
  ListProposalsParams,
  UndelegateVotesParams,
  VetoProposalParams,
} from "./governance-types";
import {
  buildReadContractTransaction,
  buildWriteContractTransaction,
  encodeProposalAction,
  toAddressScVal,
  toBytesN32ScVal,
  toOptionalProposalStatusScVal,
  type BuiltTransaction,
} from "./governance-utils";
import type { RpcServerLike } from "./types";

export class GovernanceClient {
  private readonly contractId: string;
  private readonly networkPassphrase: string;
  private readonly server: RpcServerLike;

  constructor(config: GovernanceClientConfig) {
    this.contractId = config.contractId;
    this.networkPassphrase = config.networkPassphrase;
    this.server = config.server ?? new rpc.Server(config.rpcUrl);
  }

  async createProposal(params: CreateProposalParams): Promise<BuiltTransaction> {
    return buildWriteContractTransaction(
      this.server,
      this.contractId,
      this.networkPassphrase,
      params.proposer,
      GovernanceContractMethod.CreateProposal,
      [
        toAddressScVal(params.proposer),
        encodeProposalAction(params.action),
        toBytesN32ScVal(params.descriptionHash),
        nativeToScVal(params.proposedValue, { type: "i128" }),
      ],
    );
  }

  async castVote(params: CastVoteParams): Promise<BuiltTransaction> {
    return buildWriteContractTransaction(
      this.server,
      this.contractId,
      this.networkPassphrase,
      params.voter,
      GovernanceContractMethod.CastVote,
      [
        toAddressScVal(params.voter),
        nativeToScVal(params.proposalId, { type: "u64" }),
        nativeToScVal(params.support, { type: "bool" }),
      ],
    );
  }

  async executeProposal(params: ExecuteProposalParams): Promise<BuiltTransaction> {
    return buildWriteContractTransaction(
      this.server,
      this.contractId,
      this.networkPassphrase,
      params.source,
      GovernanceContractMethod.ExecuteProposal,
      [
        nativeToScVal(params.proposalId, { type: "u64" }),
        nativeToScVal(params.totalSupply, { type: "i128" }),
      ],
    );
  }

  async vetoProposal(params: VetoProposalParams): Promise<BuiltTransaction> {
    return buildWriteContractTransaction(
      this.server,
      this.contractId,
      this.networkPassphrase,
      params.admin,
      GovernanceContractMethod.VetoProposal,
      [
        nativeToScVal(params.proposalId, { type: "u64" }),
        toBytesN32ScVal(params.reasonHash),
      ],
    );
  }

  async delegateVotes(params: DelegateVotesParams): Promise<BuiltTransaction> {
    return buildWriteContractTransaction(
      this.server,
      this.contractId,
      this.networkPassphrase,
      params.delegator,
      GovernanceContractMethod.DelegateVotes,
      [toAddressScVal(params.delegator), toAddressScVal(params.delegate)],
    );
  }

  async undelegateVotes(params: UndelegateVotesParams): Promise<BuiltTransaction> {
    return buildWriteContractTransaction(
      this.server,
      this.contractId,
      this.networkPassphrase,
      params.delegator,
      GovernanceContractMethod.UndelegateVotes,
      [toAddressScVal(params.delegator)],
    );
  }

  getProposal(params: GetProposalParams): BuiltTransaction {
    return buildReadContractTransaction(
      this.contractId,
      this.networkPassphrase,
      GovernanceContractMethod.GetProposal,
      [nativeToScVal(params.proposalId, { type: "u64" })],
    );
  }

  listProposals(params: ListProposalsParams = {}): BuiltTransaction {
    const page = params.page ?? 0;
    const pageSize = params.pageSize ?? 20;

    return buildReadContractTransaction(
      this.contractId,
      this.networkPassphrase,
      GovernanceContractMethod.ListProposals,
      [
        toOptionalProposalStatusScVal(params.status),
        nativeToScVal(page, { type: "u32" }),
        nativeToScVal(pageSize, { type: "u32" }),
      ],
    );
  }
}

export {
  GovernanceContractMethod,
  GOVERNANCE_TESTNET,
  GOVERNANCE_TESTNET_CONTRACT_ID,
} from "./governance-constants";
export {
  ProposalActionKind,
  ProposalStatus,
  type CastVoteParams,
  type CreateProposalParams,
  type DelegateVotesParams,
  type ExecuteProposalParams,
  type GetProposalParams,
  type GovernanceClientConfig,
  type GovernanceProposal,
  type ListProposalsParams,
  type ProposalAction,
  type UndelegateVotesParams,
  type VetoProposalParams,
} from "./governance-types";
export {
  parseGovernanceProposal,
  parseGovernanceProposalListSimulation,
  parseGovernanceProposalSimulation,
} from "./governance-parser";

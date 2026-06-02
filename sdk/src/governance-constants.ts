import { Networks } from "@stellar/stellar-sdk";

export const GOVERNANCE_READ_ACCOUNT =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export const GOVERNANCE_TX_TIMEOUT_SEC = 30;

export const GOVERNANCE_TESTNET_CONTRACT_ID =
  "CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB";

export const GOVERNANCE_TESTNET: {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
} = {
  contractId: GOVERNANCE_TESTNET_CONTRACT_ID,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
};

export const GovernanceContractMethod = {
  CreateProposal: "create_proposal",
  CastVote: "cast_vote",
  ExecuteProposal: "execute_proposal",
  VetoProposal: "veto_proposal",
  DelegateVotes: "delegate_votes",
  UndelegateVotes: "undelegate_votes",
  GetProposal: "get_proposal",
  ListProposals: "list_proposals",
} as const;

export type GovernanceContractMethodName =
  (typeof GovernanceContractMethod)[keyof typeof GovernanceContractMethod];

export const HASH_BYTE_LENGTH = 32;

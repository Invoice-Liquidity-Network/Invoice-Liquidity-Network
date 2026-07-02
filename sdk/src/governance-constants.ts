import { Networks } from "@stellar/stellar-sdk";

/** Read-only account address for governance simulations. */
export const GOVERNANCE_READ_ACCOUNT =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Default transaction timeout for governance operations (seconds). */
export const GOVERNANCE_TX_TIMEOUT_SEC = 30;

/** Contract ID for the governance contract on testnet. */
export const GOVERNANCE_TESTNET_CONTRACT_ID =
  "CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB";

/** Pre-configured testnet settings for the governance contract. */
export const GOVERNANCE_TESTNET: {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
} = {
  contractId: GOVERNANCE_TESTNET_CONTRACT_ID,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
};

/** Map of governance contract method names. */
export const GovernanceContractMethod = {
  CreateProposal: "create_proposal",
  CastVote: "cast_vote",
  ExecuteProposal: "execute_proposal",
  VetoProposal: "veto_proposal",
  DelegateVotes: "delegate_votes",
  UndelegateVotes: "undelegate_votes",
  GetProposal: "get_proposal",
  ListProposals: "list_proposals",
  GetMinQuorumBps: "get_min_quorum_bps",
  GetExecutionDelay: "get_execution_delay",
} as const;

/** Type union of all governance contract method names. */
export type GovernanceContractMethodName =
  (typeof GovernanceContractMethod)[keyof typeof GovernanceContractMethod];

/** Expected byte length for governance description/reason hashes. */
export const HASH_BYTE_LENGTH = 32;

/** Default minimum quorum in basis points (1000 = 10%). Mirrors the on-chain default. */
export const GOVERNANCE_DEFAULT_MIN_QUORUM_BPS = 1_000;

/** Denominator for basis-point calculations (10 000 = 100%). */
export const GOVERNANCE_BPS_DENOMINATOR = 10_000;

/** Voting window duration in seconds (259 200 s = 3 days). Mirrors the on-chain constant. */
export const GOVERNANCE_VOTING_PERIOD_SECS = 259_200;

/** Minimum token balance required to create a proposal. Mirrors the on-chain default. */
export const GOVERNANCE_DEFAULT_MIN_PROPOSAL_BALANCE = 1_000n;

/** Maximum delegation chain depth the contract resolves transitively. */
export const GOVERNANCE_MAX_DELEGATION_DEPTH = 10;

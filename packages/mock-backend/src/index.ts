// ─── Main class ───────────────────────────────────────────────────────────────
export { ILNMockBackend } from "./ILNMockBackend.js";
export type { ILNMockBackendOptions } from "./ILNMockBackend.js";

// ─── Individual clients ───────────────────────────────────────────────────────
export { MockInvoiceClient } from "./mock-invoice-client.js";
export { MockReputationClient } from "./mock-reputation-client.js";
export { MockGovernanceClient } from "./mock-governance-client.js";

// ─── Seed data (useful for test setup) ───────────────────────────────────────
export {
  SEED_INVOICES,
  SEED_REPUTATION,
  SEED_BALANCES,
  SEED_ALLOWANCES,
  SEED_PROPOSALS,
  SEED_PROTOCOL_PARAMS,
  TOKEN_METADATA_MAP,
  ALICE,
  BOB,
  CAROL,
  DAVE,
  EVE,
  FRANK,
  USDC_ID,
  EURC_ID,
} from "./seed.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  Invoice,
  InvoiceStatus,
  InvoiceClient,
  ReputationClient,
  GovernanceClient,
  PayerScore,
  TokenMetadata,
  SubmitInvoiceArgs,
  SubmittedInvoiceResult,
  UpdateInvoiceArgs,
  Proposal,
  ProposalType,
  ProposalStatus,
  VoteChoice,
  ParameterChange,
  ProtocolParameters,
  CreateProposalPayload,
} from "./types.js";

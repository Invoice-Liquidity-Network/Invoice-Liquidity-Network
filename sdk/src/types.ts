/**
 * Re-exported shared types from the @iln/shared package.
 * These represent core domain objects used throughout the SDK.
 */
export type {
  ContractEvent,
  ContractStats,
  GovernanceProposal,
  Invoice,
  InvoiceState,
  LPStats,
  ProposalStatus,
  ReputationScore,
  Token,
} from "@iln/shared";

export type {
  InvoiceCreatedEvent,
  InvoiceFundedEvent,
  InvoiceRepaidEvent,
  InvoiceDefaultedEvent,
  GovernanceProposalCreatedEvent,
  GovernanceProposalVotedEvent,
  GovernanceProposalExecutedEvent,
  TokenListedEvent,
  TokenDelistedEvent,
  ReputationUpdatedEvent,
  ContractStatsUpdatedEvent,
  LPStatsUpdatedEvent,
} from "@iln/shared";

/**
 * Parameters for submitting a new invoice to the ILN contract.
 *
 * @property freelancer - Stellar address of the freelancer submitting the invoice.
 * @property payer - Stellar address of the payer responsible for the invoice.
 * @property amount - Invoice amount in the smallest token unit (e.g. stroops for XLM).
 * @property dueDate - Unix timestamp in seconds when the invoice payment is due.
 * @property discountRate - Discount rate in basis points (e.g. 500 = 5%).
 */
export interface SubmitInvoiceParams {
  freelancer: string;
  payer: string;
  amount: bigint;
  dueDate: number;
  discountRate: number;
}

/**
 * Parameters for funding an existing invoice.
 *
 * @property funder - Stellar address of the liquidity provider funding the invoice.
 * @property invoiceId - The on-chain ID of the invoice to fund.
 */
export interface FundInvoiceParams {
  funder: string;
  invoiceId: bigint;
}

/**
 * Parameters for claiming a default on an unpaid invoice.
 *
 * @property funder - Stellar address of the liquidity provider claiming the default.
 * @property invoiceId - The on-chain ID of the invoice to claim default on.
 */
export interface ClaimDefaultParams {
  funder: string;
  invoiceId: bigint;
}

/**
 * Parameters for marking an invoice as paid.
 *
 * @property invoiceId - The on-chain ID of the invoice to mark as paid.
 */
export interface MarkPaidParams {
  invoiceId: bigint;
}

/**
 * Protocol-level configuration retrieved from the ILN smart contract.
 *
 * @property minInvoiceAmount - Minimum invoice amount allowed by the protocol.
 * @property maxDiscountRate - Maximum discount rate in basis points.
 * @property protocolFeeBps - Protocol fee in basis points.
 * @property minPayerReputation - Minimum reputation score required for payers.
 * @property decayRateBps - Reputation decay rate in basis points.
 * @property maxInvoiceDuration - Optional maximum invoice duration in seconds.
 * @property minInvoiceDuration - Optional minimum invoice duration in seconds.
 * @property gracePeriodSeconds - Optional grace period in seconds after due date.
 */
export interface ProtocolConfig {
  minInvoiceAmount: bigint;
  maxDiscountRate: number;
  protocolFeeBps: number;
  minPayerReputation: number;
  decayRateBps: number;
  maxInvoiceDuration?: number;
  minInvoiceDuration?: number;
  gracePeriodSeconds?: number;
}

/**
 * Options passed to a transaction signer when signing.
 *
 * @property address - Optional Stellar address to sign as (for multi-sig wallets).
 * @property networkPassphrase - The Stellar network passphrase for the target network.
 */
export interface SignTransactionOptions {
  address?: string;
  networkPassphrase: string;
}

/**
 * Interface for transaction signing implementations.
 * Implement this to integrate with hardware wallets, browser extensions, or custom signers.
 *
 * @example
 * ```ts
 * const signer: TransactionSigner = {
 *   async getPublicKey() { return "GABC..."; },
 *   async signTransaction(xdr, opts) { return signedXdr; },
 * };
 * ```
 */
export interface TransactionSigner {
  /** Returns the public key of the signing account. */
  getPublicKey(): Promise<string>;
  /**
   * Sign a serialized transaction.
   * @param transactionXdr - Base64-encoded XDR transaction envelope.
   * @param options - Signing options including network passphrase.
   * @returns The signed transaction as a base64-encoded XDR string.
   */
  signTransaction(
    transactionXdr: string,
    options: SignTransactionOptions,
  ): Promise<string>;
}

/**
 * Abstraction over a Stellar RPC server for dependency injection and testing.
 * Compatible with @stellar/stellar-sdk's `rpc.Server`.
 */
export interface RpcServerLike {
  getAccount(address: string): Promise<unknown>;
  simulateTransaction(transaction: unknown): Promise<unknown>;
  prepareTransaction(transaction: unknown): Promise<{ toXDR(): string }>;
  sendTransaction(transaction: unknown): Promise<unknown>;
  pollTransaction(hash: string, options?: { attempts?: number }): Promise<unknown>;
  getLatestLedger?(): Promise<unknown>;
}

/**
 * Configuration for initializing the ILN SDK client.
 *
 * @property contractId - The Soroban contract ID for the ILN contract.
 * @property rpcUrl - URL of the Stellar Soroban RPC server.
 * @property networkPassphrase - The Stellar network passphrase (e.g. `Networks.TESTNET`).
 * @property signer - Optional transaction signer for state-changing operations.
 * @property server - Optional custom RPC server implementation.
 * @property timeoutMs - Fallback timeout for all network requests in ms (default: 30000).
 * @property timeouts - Per-operation timeout overrides in milliseconds.
 *
 * @example
 * ```ts
 * import { ILNSdk, ILN_TESTNET } from "@invoice-liquidity/sdk";
 *
 * const sdk = new ILNSdk({
 *   ...ILN_TESTNET,
 *   signer: createKeypairSigner(secretKey),
 * });
 * ```
 */
export interface ILNSdkConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  signer?: TransactionSigner;
  server?: RpcServerLike;
  timeoutMs?: number;
  timeouts?: {
    readMs?: number;
    writeMs?: number;
    simulationMs?: number;
  };
  cache?: CacheConfig;
  /**
   * Enable the offline transaction queue.
   * When provided, write methods (`submitInvoice`, `fundInvoice`, `markPaid`,
   * `claimDefault`) will automatically queue operations while the client is
   * offline and submit them when connectivity is restored.
   * Set to `{}` to use all defaults.
   */
  offline?: import("./offline").OfflineConfig;
}

/**
 * Pre-configured network settings for connecting to a Stellar network.
 * Use the built-in `ILN_TESTNET` constant for testnet connections.
 */
export interface NetworkConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * Result of an SDK-to-contract compatibility check.
 *
 * @property compatible - Whether the SDK and contract versions are compatible.
 * @property contractVersion - The deployed contract's semver version string.
 * @property sdkVersion - The SDK's semver version string.
 * @property issues - List of compatibility issues found (empty if compatible).
 */
export interface CompatibilityResult {
  compatible: boolean;
  contractVersion: string;
  sdkVersion: string;
  issues: string[];
}

/**
 * Parsed semantic version with numeric components.
 *
 * @property major - Major version number.
 * @property minor - Minor version number.
 * @property patch - Patch version number.
 * @property raw - Original unparsed version string.
 */
export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

/**
 * A deprecation warning for a deprecated SDK method.
 *
 * @property method - The deprecated method name.
 * @property message - Human-readable deprecation message.
 * @property alternative - The recommended replacement method (if any).
 * @property removedIn - The SDK version where the method will be removed.
 */
export interface DeprecationWarning {
  method: string;
  message: string;
  alternative?: string;
  removedIn?: string;
}

/**
 * A migration guide describing changes between two SDK versions.
 *
 * @property fromVersion - The source version to migrate from.
 * @property toVersion - The target version to migrate to.
 * @property changes - List of changes between the versions.
 */
export interface MigrationGuide {
  fromVersion: string;
  toVersion: string;
  changes: MigrationChange[];
}

/**
 * A single change entry in a migration guide.
 *
 * @property type - The type of change: "breaking", "deprecated", "added", or "removed".
 * @property description - Human-readable description of the change.
 * @property migration - Migration instructions (if applicable).
 */
export interface MigrationChange {
  type: "breaking" | "deprecated" | "added" | "removed";
  description: string;
  migration?: string;
}

/**
 * Result of executing a batch of operations.
 *
 * @property success - Whether the entire batch succeeded.
 * @property transactionHash - The on-chain transaction hash (if submitted).
 * @property results - Per-operation results with individual success/failure.
 * @property totalFee - Total network fee paid for the batch in stroops.
 */
export interface BatchResult {
  success: boolean;
  transactionHash?: string;
  results: BatchOperationResult[];
  totalFee: bigint;
}

/**
 * Result of a single operation within a batch.
 *
 * @property index - The index of the operation in the batch.
 * @property success - Whether this specific operation succeeded.
 * @property error - Error message if the operation failed.
 * @property invoiceId - The invoice ID if the operation created one.
 */
export interface BatchOperationResult {
  index: number;
  success: boolean;
  error?: string;
  invoiceId?: bigint;
}

/**
 * Parameters for batch-submitting multiple invoices in a single transaction.
 *
 * @property invoices - Array of invoice parameters to submit.
 */
export interface BatchSubmitParams {
  invoices: Array<{
    freelancer: string;
    payer: string;
    amount: bigint;
    dueDate: number;
    discountRate: number;
  }>;
}

/**
 * Parameters for batch-funding multiple invoices in a single transaction.
 *
 * @property funder - Stellar address of the funding account.
 * @property invoiceIds - Array of invoice IDs to fund.
 */
export interface BatchFundParams {
  funder: string;
  invoiceIds: bigint[];
}

/**
 * Parameters for batch-marking multiple invoices as paid in a single transaction.
 *
 * @property invoiceIds - Array of invoice IDs to mark as paid.
 */
export interface BatchPayParams {
  invoiceIds: bigint[];
}

export interface CacheConfig {
  ttl: number;
  storage: "memory" | "localStorage";
  enabled: boolean;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheStatistics {
  hits: number;
  misses: number;
  size: number;
}

export interface CacheOptions {
  key?: string;
  ttl?: number;
}

export interface TimeoutError extends Error {
  code: "TIMEOUT";
  timeoutMs: number;
}

export interface RequestTimeouts {
  readMs: number;
  writeMs: number;
  simulationMs: number;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  monitorIntervalMs: number;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number | null;
  state: "closed" | "open" | "half-open";
}

export interface OfflineConfig {
  maxQueueSize: number;
  retryIntervalMs: number;
  maxRetries: number;
}

export interface OfflineQueueItem {
  id: string;
  operation: string;
  params: unknown;
  timestamp: number;
  retries: number;
}

export interface OfflineState {
  isOnline: boolean;
  queueSize: number;
  lastSyncTime: number | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface StellarAddressValidationOptions {
  allowTestnet?: boolean;
  allowMainnet?: boolean;
}

export interface AmountValidationOptions {
  min?: bigint;
  max?: bigint;
  decimals?: number;
}

export interface DateValidationOptions {
  allowPast?: boolean;
  maxFutureDays?: number;
}

export interface DiscountRateValidationOptions {
  minBps?: number;
  maxBps?: number;
}

export interface PluginContext {
  config: ILNSdkConfig;
  client: unknown;
}

export interface ILNPlugin {
  name: string;
  version: string;
  install(context: PluginContext): void;
  uninstall?(): void;
}

export interface EventHistoryEntry {
  event: string;
  data: unknown;
  timestamp: number;
}

export interface NotificationTrigger {
  type: "invoice_created" | "invoice_submitted" | "invoice_funded" | "invoice_paid" | "invoice_defaulted" | "invoice_disputed";
  invoiceId?: bigint;
}

export interface SubscriptionChannel {
  type: "webhook" | "email";
  url?: string;
  email?: string;
}

export interface Subscription {
  id: string;
  trigger: NotificationTrigger;
  channel: SubscriptionChannel;
  active: boolean;
  createdAt: string;
}

export interface ProtocolStats {
  totalInvoices: number;
  totalVolume: bigint;
  totalYield: bigint;
  defaultRate: number;
}

export interface FreelancerStats {
  submitted: number;
  funded: number;
  totalReceived: bigint;
  avgDiscount: number;
}

export interface AnalyticsInvoice {
  id: bigint;
  status: string;
  amount: bigint;
  discountRate: number;
  createdAt: number;
}

export interface LPStat {
  address: string;
  yield: bigint;
  invoiceCount: number;
}

export interface YieldProjection {
  apy: number;
  projectedYield: bigint;
  timeframe: string;
}

export interface RiskFactors {
  defaultRisk: number;
  liquidityRisk: number;
  volatilityRisk: number;
}

export interface PortfolioAllocation {
  conservative: number;
  moderate: number;
  aggressive: number;
}

export interface HistoricalPerformance {
  period: string;
  totalYield: bigint;
  avgApy: number;
  maxDrawdown: number;
}

export interface ComparisonResult {
  metric: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

export interface FederationRecord {
  stellarAddress: string;
  memo?: string;
  memoType?: string;
}

export interface FederationRecordManager {
  resolve(address: string): Promise<FederationRecord>;
  register(record: FederationRecord): Promise<void>;
}

export type FederationResolutionError = Error;

export interface GovernanceContractMethod {
  name: string;
  description: string;
}

export const GOVERNANCE_TESTNET = {
  contractId: "C_GOVERNANCE_TESTNET_CONTRACT_ID",
  networkPassphrase: "Test SDF Network ; September 2015",
};

export const GOVERNANCE_TESTNET_CONTRACT_ID = "C_GOVERNANCE_TESTNET_CONTRACT_ID";

export enum ProposalActionKind {
  ParameterChange = "parameter_change",
  ContractUpgrade = "contract_upgrade",
  TreasurySpend = "treasury_spend",
}

export interface GovernanceParamTypes {
  minInvoiceAmount: bigint;
  maxDiscountRate: number;
  protocolFeeBps: number;
  minPayerReputation: number;
}

export interface ILNClient {
  getInvoice(id: number | bigint): Promise<Invoice>;
  getInvoicesByIssuer(issuer: string): Promise<Invoice[]>;
  getInvoicesByStatus(status: string): Promise<Invoice[]>;
  getReputationScore(address: string): Promise<ReputationScore>;
  getLPPortfolio(address: string): Promise<LPPortfolio>;
  getContractStats(): Promise<ContractStats>;
  getProposal(id: number | bigint): Promise<GovernanceProposal>;
  getTokenBalances(address: string): Promise<TokenBalance[]>;
  submitInvoice(params: Record<string, unknown>): Promise<unknown>;
  fundInvoice(params: Record<string, unknown>): Promise<void>;
  markPaid(params: Record<string, unknown>): Promise<void>;
  createProposal(params: Record<string, unknown>): Promise<unknown>;
  vote(params: Record<string, unknown>): Promise<void>;
  connectWallet(): Promise<string>;
  getLPCoverage?(address: string): Promise<import("./insurance-types").LPCoverage | null>;
  getPoolBalance?(): Promise<import("./insurance-types").PoolBalance>;
  getClaim?(claimId: bigint): Promise<import("./insurance-types").InsuranceClaim>;
  listClaims?(statusFilter?: import("./insurance-types").ClaimStatus, page?: number, pageSize?: number): Promise<import("./insurance-types").InsuranceClaim[]>;
  enroll?(params: import("./insurance-types").EnrollParams): Promise<void>;
  depositPremium?(params: import("./insurance-types").DepositPremiumParams): Promise<void>;
  submitClaim?(params: import("./insurance-types").SubmitClaimParams): Promise<bigint>;
  reviewClaim?(params: import("./insurance-types").ReviewClaimParams): Promise<void>;
}

export interface TokenBalance {
  token: string;
  contractId: string;
  balance: bigint;
}

export interface LPPortfolio {
  address: string;
  totalInvested: bigint;
  totalYield: bigint;
  activePositions: number;
  completedPositions: number;
  defaultedPositions: number;
  avgReturn: number;
}

export interface Proposal {
  id: number;
  proposer: string;
  parameter: string;
  newValue: number;
  votesFor: bigint;
  votesAgainst: bigint;
  deadline: number;
  executed: boolean;
}

export function parseGovernanceProposal(data: unknown): GovernanceProposal {
  return data as GovernanceProposal;
}

export function parseGovernanceProposalSimulation(data: unknown): GovernanceProposal {
  return data as GovernanceProposal;
}

export function parseGovernanceProposalListSimulation(data: unknown): GovernanceProposal[] {
  return data as GovernanceProposal[];
}

import type { OfflineConfig } from "./offline";

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

export interface SubmitInvoiceParams {
  freelancer: string;
  payer: string;
  amount: bigint;
  dueDate: number;
  discountRate: number;
}

export interface FundInvoiceParams {
  funder: string;
  invoiceId: bigint;
}

export interface ClaimDefaultParams {
  funder: string;
  invoiceId: bigint;
}

export interface MarkPaidParams {
  invoiceId: bigint;
}

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

export interface SignTransactionOptions {
  address?: string;
  networkPassphrase: string;
}

export interface TransactionSigner {
  getPublicKey(): Promise<string>;
  signTransaction(
    transactionXdr: string,
    options: SignTransactionOptions,
  ): Promise<string>;
}

export interface RpcServerLike {
  getAccount(address: string): Promise<unknown>;
  simulateTransaction(transaction: unknown): Promise<unknown>;
  prepareTransaction(transaction: unknown): Promise<{ toXDR(): string }>;
  sendTransaction(transaction: unknown): Promise<unknown>;
  pollTransaction(hash: string, options?: { attempts?: number }): Promise<unknown>;
}

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
  offline?: OfflineConfig;
}

export interface NetworkConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  contractVersion: string;
  sdkVersion: string;
  issues: string[];
}

export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export interface DeprecationWarning {
  method: string;
  message: string;
  alternative?: string;
  removedIn?: string;
}

export interface MigrationGuide {
  fromVersion: string;
  toVersion: string;
  changes: MigrationChange[];
}

export interface MigrationChange {
  type: "breaking" | "deprecated" | "added" | "removed";
  description: string;
  migration?: string;
}

export interface BatchResult {
  success: boolean;
  transactionHash?: string;
  results: BatchOperationResult[];
  totalFee: bigint;
}

export interface BatchOperationResult {
  index: number;
  success: boolean;
  error?: string;
  invoiceId?: bigint;
}

export interface BatchSubmitParams {
  invoices: Array<{
    freelancer: string;
    payer: string;
    amount: bigint;
    dueDate: number;
    discountRate: number;
  }>;
}

export interface BatchFundParams {
  funder: string;
  invoiceIds: bigint[];
}

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
  type: "invoice_created" | "invoice_funded" | "invoice_paid" | "invoice_defaulted";
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

export function parseGovernanceProposal(data: unknown): GovernanceProposal {
  return data as GovernanceProposal;
}

export function parseGovernanceProposalSimulation(data: unknown): GovernanceProposal {
  return data as GovernanceProposal;
}

export function parseGovernanceProposalListSimulation(data: unknown): GovernanceProposal[] {
  return data as GovernanceProposal[];
}

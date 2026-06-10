import type { InvoiceState } from "@iln/shared";

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

export type InvoiceStatus = InvoiceState;

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
  /**
   * Fallback timeout for SDK network requests in milliseconds.
   * Defaults to 30_000 when an operation-specific timeout is not configured.
   */
  timeoutMs?: number;
  /**
   * Operation-specific request timeouts in milliseconds.
   * Defaults: readMs 10_000, writeMs 30_000, simulationMs 15_000.
   */
  timeouts?: {
    readMs?: number;
    writeMs?: number;
    simulationMs?: number;
  };
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

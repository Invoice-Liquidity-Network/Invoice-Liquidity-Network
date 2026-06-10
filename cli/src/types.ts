export type SupportedNetwork = "testnet" | "mainnet" | "standalone";

export interface ResolvedConfig {
  contractId: string;
  keypairPath: string;
  network: SupportedNetwork;
  networkPassphrase: string;
  rpcUrl: string;
  tokenId?: string;
}

export interface FileConfig {
  contractId?: string;
  keypairPath?: string;
  network?: SupportedNetwork;
  networkPassphrase?: string;
  rpcUrl?: string;
  tokenId?: string;
}

export interface Invoice {
  amount: bigint;
  amountFunded: bigint;
  discountRate: number;
  dueDate: number;
  freelancer: string;
  fundedAt: number | null;
  funder: string | null;
  id: bigint;
  payer: string;
  status: string;
  token: string;
}

export interface ListedInvoice extends Invoice {
  role: "freelancer" | "payer" | "funder";
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

export interface SubmitInvoiceInput {
  amount: bigint;
  discountRate: number;
  dueDate: number;
  payer: string;
  tokenId: string;
}

export interface TransactionSigner {
  getPublicKey(): Promise<string>;
  signTransaction(transactionXdr: string, networkPassphrase: string): Promise<string>;
}

export interface RpcServerLike {
  getAccount(address: string): Promise<unknown>;
  simulateTransaction(transaction: unknown): Promise<unknown>;
  prepareTransaction(transaction: unknown): Promise<{ toXDR(): string }>;
  sendTransaction(transaction: unknown): Promise<unknown>;
  pollTransaction(hash: string, options?: { attempts?: number }): Promise<unknown>;
  getHealth?(): Promise<{ status?: string }>;
}

export interface ClientOptions {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  server?: RpcServerLike;
  signer: TransactionSigner;
}

export interface WriteResult {
  hash: string;
}

export interface SimulationLike {
  error?: unknown;
  result?: {
    retval?: unknown;
  };
}

/**
 * Represents a parsed contract event from a Horizon transaction record.
 */
export interface ContractEvent {
  /** The contract that emitted this event */
  contractId: string;
  /** Raw event type string (e.g. "InvoiceCreated", "InvoiceFunded") */
  type: string;
  /** Parsed event topics as decoded XDR values */
  topics: unknown[];
  /** Parsed event value as decoded XDR */
  value: unknown;
  /** Ledger sequence number when the event was emitted */
  ledger: number;
  /** ISO-8601 timestamp of the ledger close */
  ledgerClosedAt: string;
  /** Transaction hash that contained this event */
  txHash: string;
  /** Paging token for cursor-based pagination */
  pagingToken: string;
}

/**
 * Options for configuring the ILNEventIndexer.
 */
export interface IndexerOptions {
  /** Horizon server base URL. Defaults to Stellar mainnet. */
  horizonUrl?: string;
  /** Network passphrase for XDR decoding */
  networkPassphrase?: string;
  /** Number of records to fetch per page (max 200). Defaults to 200. */
  pageSize?: number;
  /** Request timeout in milliseconds. Defaults to 30_000. */
  timeoutMs?: number;
}

/**
 * Known ILN contract event types.
 */
export type ILNEventType =
  | 'InvoiceCreated'
  | 'InvoiceFunded'
  | 'InvoiceRepaid'
  | 'InvoiceDefaulted'
  | 'LiquidityAdded'
  | 'LiquidityRemoved'
  | 'ReputationUpdated'
  | string; // allow arbitrary strings for forward-compat

/**
 * Callback signature for streaming subscriptions.
 */
export type EventCallback = (event: ContractEvent) => void | Promise<void>;

/**
 * Handle returned from subscribe() — call .close() to stop the stream.
 */
export interface SubscriptionHandle {
  close(): void;
}

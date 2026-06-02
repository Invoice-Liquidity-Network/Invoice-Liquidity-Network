// ─── Invoice ──────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'Pending' | 'Funded' | 'Paid' | 'Defaulted';

/**
 * Invoice row as stored in SQLite.
 * `amount` is stored as a string because i128 can exceed JS Number.MAX_SAFE_INTEGER.
 */
export interface Invoice {
  id: number;
  freelancer: string;
  payer: string;
  /** Full invoice value in stroops (1 USDC = 10_000_000). Stored as string. */
  amount: string;
  /** Unix timestamp — when the payer must settle by. */
  due_date: number;
  /** Basis points, e.g. 300 = 3.00%. */
  discount_rate: number;
  status: InvoiceStatus;
  funder: string | null;
  funded_at: number | null;
  created_at: number;
  updated_at: number;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type ILNEventType = 'submitted' | 'funded' | 'paid' | 'defaulted';

/** Processed ILN contract event as stored in SQLite. */
export interface ILNEvent {
  /** Unique Soroban event ID  (e.g. "0000001234-0-0"). Used for deduplication. */
  event_id: string;
  event_type: ILNEventType;
  invoice_id: number;
  ledger: number;
  /** ISO 8601 timestamp of ledger close. */
  ledger_closed_at: string;
  created_at: number;
}

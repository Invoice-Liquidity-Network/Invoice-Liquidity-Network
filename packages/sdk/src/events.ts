import { scValToNative, xdr as stellarXdr } from '@stellar/stellar-sdk';

/**
 * A raw Soroban contract event with decoded XDR topics and value.
 * Consumers can obtain this from Horizon/SorobanRPC by decoding
 * base64-encoded XDR using the `xdr.decode()` utility.
 */
export interface RawEvent {
  /** Decoded XDR ScVal topics (first element is the event name symbol). */
  topics: stellarXdr.ScVal[];
  /** Decoded XDR ScVal value (event data payload). */
  value: stellarXdr.ScVal;
}

// ---------------------------------------------------------------------------
// Event type definitions
//
// These are flat XDR-parsed projections — a subset of the fields in @iln/shared's
// ContractEventBase-extending event types. They represent what the Soroban XDR
// parser extracts from raw event data, not the full contract event shape.
// Prefer @iln/shared's event types when you need the complete payload.
// ---------------------------------------------------------------------------

/**
 * Parsed InvoiceSubmitted event (XDR projection).
 *
 * Intentionally differs from @iln/shared's InvoiceSubmittedEvent which extends
 * ContractEventBase and nests a full `Invoice` struct. This type is a flat
 * extraction of the fields available directly from the Soroban event XDR.
 */
export interface InvoiceSubmittedEvent {
  type: 'InvoiceSubmitted';
  /** Unique invoice identifier. */
  invoiceId: bigint;
  /** Stellar address of the invoice issuer (freelancer). */
  issuer: string;
  /** Invoice amount in base units (stroops). */
  amount: bigint;
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

/**
 * Parsed InvoiceFunded event (XDR projection).
 * See InvoiceSubmittedEvent comment for why this differs from @iln/shared.
 */
export interface InvoiceFundedEvent {
  type: 'InvoiceFunded';
  /** Unique invoice identifier. */
  invoiceId: bigint;
  /** Stellar address of the liquidity provider who funded the invoice. */
  funder: string;
  /** Amount funded in base units (stroops). */
  amount: bigint;
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

/**
 * Parsed InvoicePaid event (XDR projection).
 * See InvoiceSubmittedEvent comment for why this differs from @iln/shared.
 */
export interface InvoicePaidEvent {
  type: 'InvoicePaid';
  /** Unique invoice identifier. */
  invoiceId: bigint;
  /** Stellar address of the payer who settled the invoice. */
  payer: string;
  /** Amount paid in base units (stroops). */
  amount: bigint;
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

export interface InvoiceCancelledEvent {
  type: 'InvoiceCancelled';
  /** Unique invoice identifier. */
  invoiceId: bigint;
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

export interface InvoiceExpiredEvent {
  type: 'InvoiceExpired';
  /** Unique invoice identifier. */
  invoiceId: bigint;
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

export interface InvoiceDisputedEvent {
  type: 'InvoiceDisputed';
  /** Unique invoice identifier. */
  invoiceId: bigint;
  /** Stellar address of the party who filed the dispute. */
  disputer: string;
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

/**
 * Parsed ReputationUpdated event (XDR projection).
 * See InvoiceSubmittedEvent comment for why this differs from @iln/shared.
 */
export interface ReputationUpdatedEvent {
  type: 'ReputationUpdated';
  /** Stellar address whose reputation was updated. */
  address: string;
  /** New reputation score (0–100). */
  score: number;
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

export interface ContractPausedEvent {
  type: 'ContractPaused';
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

/**
 * Parsed TokenAdded event (XDR projection).
 * See InvoiceSubmittedEvent comment for why this differs from @iln/shared.
 */
export interface TokenAddedEvent {
  type: 'TokenAdded';
  /** Stellar Asset Contract address of the newly supported token. */
  token: string;
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

export interface LPPositionTransferredEvent {
  type: 'LPPositionTransferred';
  /** Stellar address of the previous LP position holder. */
  from: string;
  /** Stellar address of the new LP position holder. */
  to: string;
  /** Invoice ID whose LP position was transferred. */
  invoiceId: bigint;
  /** Ledger close timestamp of the event. */
  timestamp: bigint;
}

/**
 * Discriminated union of all known contract events.
 * Discriminated by the `type` field.
 *
 * Intentionally differs from @iln/shared's ContractEvent: this union contains
 * the SDK's flat XDR-parsed event types (InvoiceCancelledEvent, etc.) which
 * are not in @iln/shared. The shared version extends ContractEventBase and
 * includes governance events not parsed here.
 */
export type ContractEvent =
  | InvoiceSubmittedEvent
  | InvoiceFundedEvent
  | InvoicePaidEvent
  | InvoiceCancelledEvent
  | InvoiceExpiredEvent
  | InvoiceDisputedEvent
  | ReputationUpdatedEvent
  | ContractPausedEvent
  | TokenAddedEvent
  | LPPositionTransferredEvent;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function nativeValue(scVal: stellarXdr.ScVal): unknown {
  try {
    return scValToNative(scVal);
  } catch {
    return null;
  }
}

function symbolToString(scVal: stellarXdr.ScVal): string | null {
  const val = nativeValue(scVal);
  return typeof val === 'string' ? val : null;
}

function toBigint(val: unknown): bigint | null {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') return BigInt(val);
  if (typeof val === 'string') {
    try {
      return BigInt(val);
    } catch {
      return null;
    }
  }
  return null;
}

function toNumber(val: unknown): number | null {
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  return null;
}

function toString(val: unknown): string | null {
  if (typeof val === 'string') return val;
  return null;
}

function getField(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj instanceof Map) return obj.get(key);
  return (obj as Record<string, unknown>)[key];
}

function extractBigintMap(scVal: stellarXdr.ScVal, key: string): bigint | null {
  const native = nativeValue(scVal);
  const val = getField(native, key);
  return toBigint(val);
}

function extractNumberMap(scVal: stellarXdr.ScVal, key: string): number | null {
  const native = nativeValue(scVal);
  const val = getField(native, key);
  return toNumber(val);
}

function extractStringMap(scVal: stellarXdr.ScVal, key: string): string | null {
  const native = nativeValue(scVal);
  const val = getField(native, key);
  return toString(val);
}

// ---------------------------------------------------------------------------
// Event name → symbol mapping
// ---------------------------------------------------------------------------

const EVENT_NAME_MAP: Record<string, string> = {
  invoice_submitted: 'InvoiceSubmitted',
  invoice_funded: 'InvoiceFunded',
  invoice_paid: 'InvoicePaid',
  invoice_cancelled: 'InvoiceCancelled',
  invoice_expired: 'InvoiceExpired',
  invoice_disputed: 'InvoiceDisputed',
  reputation_updated: 'ReputationUpdated',
  contract_paused: 'ContractPaused',
  token_added: 'TokenAdded',
  lp_position_transferred: 'LPPositionTransferred',
};

// ---------------------------------------------------------------------------
// Individual event parsers
// ---------------------------------------------------------------------------

/**
 * Parses an `InvoiceSubmitted` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseInvoiceSubmittedEvent(raw: RawEvent): InvoiceSubmittedEvent | null {
  if (raw.topics.length < 2) return null;
  const name = symbolToString(raw.topics[0]);
  if (name !== 'invoice_submitted') return null;

  const invoiceId = toBigint(nativeValue(raw.topics[1]));
  if (invoiceId === null) return null;

  return {
    type: 'InvoiceSubmitted',
    invoiceId,
    issuer: toString(nativeValue(raw.topics[2])) ?? '',
    amount: extractBigintMap(raw.value, 'amount') ?? 0n,
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

/**
 * Parses an `InvoiceFunded` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseInvoiceFundedEvent(raw: RawEvent): InvoiceFundedEvent | null {
  if (raw.topics.length < 2) return null;
  const name = symbolToString(raw.topics[0]);
  if (name !== 'invoice_funded') return null;

  const invoiceId = toBigint(nativeValue(raw.topics[1]));
  if (invoiceId === null) return null;

  return {
    type: 'InvoiceFunded',
    invoiceId,
    funder: toString(nativeValue(raw.topics[2])) ?? '',
    amount: extractBigintMap(raw.value, 'amount') ?? 0n,
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

/**
 * Parses an `InvoicePaid` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseInvoicePaidEvent(raw: RawEvent): InvoicePaidEvent | null {
  if (raw.topics.length < 2) return null;
  const name = symbolToString(raw.topics[0]);
  if (name !== 'invoice_paid') return null;

  const invoiceId = toBigint(nativeValue(raw.topics[1]));
  if (invoiceId === null) return null;

  return {
    type: 'InvoicePaid',
    invoiceId,
    payer: toString(nativeValue(raw.topics[2])) ?? '',
    amount: extractBigintMap(raw.value, 'amount') ?? 0n,
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

/**
 * Parses an `InvoiceCancelled` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseInvoiceCancelledEvent(raw: RawEvent): InvoiceCancelledEvent | null {
  if (raw.topics.length < 2) return null;
  const name = symbolToString(raw.topics[0]);
  if (name !== 'invoice_cancelled') return null;

  const invoiceId = toBigint(nativeValue(raw.topics[1]));
  if (invoiceId === null) return null;

  return {
    type: 'InvoiceCancelled',
    invoiceId,
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

/**
 * Parses an `InvoiceExpired` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseInvoiceExpiredEvent(raw: RawEvent): InvoiceExpiredEvent | null {
  if (raw.topics.length < 2) return null;
  const name = symbolToString(raw.topics[0]);
  if (name !== 'invoice_expired') return null;

  const invoiceId = toBigint(nativeValue(raw.topics[1]));
  if (invoiceId === null) return null;

  return {
    type: 'InvoiceExpired',
    invoiceId,
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

/**
 * Parses an `InvoiceDisputed` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseInvoiceDisputedEvent(raw: RawEvent): InvoiceDisputedEvent | null {
  if (raw.topics.length < 2) return null;
  const name = symbolToString(raw.topics[0]);
  if (name !== 'invoice_disputed') return null;

  const invoiceId = toBigint(nativeValue(raw.topics[1]));
  if (invoiceId === null) return null;

  return {
    type: 'InvoiceDisputed',
    invoiceId,
    disputer: toString(nativeValue(raw.topics[2])) ?? '',
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

/**
 * Parses a `ReputationUpdated` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseReputationUpdatedEvent(raw: RawEvent): ReputationUpdatedEvent | null {
  const name = symbolToString(raw.topics[0]);
  if (name !== 'reputation_updated') return null;

  return {
    type: 'ReputationUpdated',
    address: toString(nativeValue(raw.topics[1])) ?? '',
    score: extractNumberMap(raw.value, 'score') ?? 0,
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

/**
 * Parses a `ContractPaused` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseContractPausedEvent(raw: RawEvent): ContractPausedEvent | null {
  const name = symbolToString(raw.topics[0]);
  if (name !== 'contract_paused') return null;

  return {
    type: 'ContractPaused',
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

/**
 * Parses a `TokenAdded` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseTokenAddedEvent(raw: RawEvent): TokenAddedEvent | null {
  const name = symbolToString(raw.topics[0]);
  if (name !== 'token_added') return null;

  return {
    type: 'TokenAdded',
    token: toString(nativeValue(raw.topics[1])) ?? '',
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

/**
 * Parses an `LPPositionTransferred` event from raw Soroban event data.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed event or `null` if the data does not match this event.
 */
export function parseLPPositionTransferredEvent(raw: RawEvent): LPPositionTransferredEvent | null {
  if (raw.topics.length < 3) return null;
  const name = symbolToString(raw.topics[0]);
  if (name !== 'lp_position_transferred') return null;

  return {
    type: 'LPPositionTransferred',
    from: toString(nativeValue(raw.topics[1])) ?? '',
    to: toString(nativeValue(raw.topics[2])) ?? '',
    invoiceId: toBigint(nativeValue(raw.topics[3])) ?? 0n,
    timestamp: extractBigintMap(raw.value, 'timestamp') ?? 0n,
  };
}

// ---------------------------------------------------------------------------
// Individual parser registry
// ---------------------------------------------------------------------------

type ParserFn = (raw: RawEvent) => ContractEvent | null;

const PARSERS: Record<string, ParserFn> = {
  invoice_submitted: parseInvoiceSubmittedEvent as ParserFn,
  invoice_funded: parseInvoiceFundedEvent as ParserFn,
  invoice_paid: parseInvoicePaidEvent as ParserFn,
  invoice_cancelled: parseInvoiceCancelledEvent as ParserFn,
  invoice_expired: parseInvoiceExpiredEvent as ParserFn,
  invoice_disputed: parseInvoiceDisputedEvent as ParserFn,
  reputation_updated: parseReputationUpdatedEvent as ParserFn,
  contract_paused: parseContractPausedEvent as ParserFn,
  token_added: parseTokenAddedEvent as ParserFn,
  lp_position_transferred: parseLPPositionTransferredEvent as ParserFn,
};

// ---------------------------------------------------------------------------
// Unified dispatcher
// ---------------------------------------------------------------------------

/**
 * Parses any known Soroban contract event from raw event data.
 *
 * Inspects `topics[0]` to determine the event type and delegates to the
 * appropriate parser. Returns `null` for unknown or malformed events.
 *
 * @param raw - The decoded raw event (topics + value).
 * @returns The typed {@link ContractEvent} or `null` if unknown.
 *
 * @example
 * ```ts
 * import { parseContractEvent } from '@iln/sdk';
 * import { xdr } from '@iln/sdk';
 *
 * const raw: RawEvent = {
 *   topics: [xdr.decode('AAAAEAAA...')],
 *   value: xdr.decode('AAAAEQAA...'),
 * };
 * const event = parseContractEvent(raw);
 * if (event?.type === 'InvoiceFunded') {
 *   console.log(event.invoiceId, event.funder);
 * }
 * ```
 */
export function parseContractEvent(raw: RawEvent): ContractEvent | null {
  if (!raw || !raw.topics || raw.topics.length === 0) return null;

  const name = symbolToString(raw.topics[0]);
  if (!name) return null;

  const parser = PARSERS[name];
  if (!parser) return null;

  return parser(raw);
}

/**
 * Returns the list of all supported event type names (PascalCase).
 */
export function supportedEventTypes(): string[] {
  return Object.values(EVENT_NAME_MAP);
}

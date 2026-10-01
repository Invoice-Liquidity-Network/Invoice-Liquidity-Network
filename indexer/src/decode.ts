import { scValToNative, type xdr } from '@stellar/stellar-sdk';
import type { ILNEvent, ILNEventType } from './types';

/**
 * Total, side-effect-free decoding of a raw Soroban event into an `ILNEvent`.
 *
 * `processEvent` used to read fields straight off the RPC payload and crash
 * on anything unexpected (null topics, non-XDR values, float ledgers, numeric
 * ids). Property-based fuzzing (tests/processor.fuzz.test.ts) found seven such
 * crash classes. Every input now lands in exactly one of three buckets:
 *
 *   ok        – a well-formed event for a known topic
 *   ignored   – well-formed but not ours (empty topic, unknown symbol)
 *   malformed – structurally invalid; the caller routes it to the dead-letter
 *               table so it is never silently dropped and never crashes the
 *               poller
 */
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<ILNEventType>([
  'submitted',
  'funded',
  'paid',
  'defaulted',
]);

export const MAX_EVENT_ID_LENGTH = 128;
export const MAX_LEDGER_CLOSED_AT_LENGTH = 64;

export type MalformedReason =
  | 'not_an_object'
  | 'event_id_invalid'
  | 'ledger_invalid'
  | 'ledger_closed_at_invalid'
  | 'topic_not_array'
  | 'topic_not_scval'
  | 'topic_decode_failed'
  | 'topic_not_symbol'
  | 'value_not_scval'
  | 'value_decode_failed'
  | 'invoice_id_invalid';

export type IgnoredReason = 'empty_topic' | 'unknown_topic';

export type DecodedEvent =
  | { kind: 'ok'; event: ILNEvent }
  | { kind: 'ignored'; reason: IgnoredReason }
  | { kind: 'malformed'; reason: MalformedReason; detail?: string };

/** Duck-typed check for a stellar-sdk `xdr.ScVal` (survives cross-realm and mocked inputs). */
export function isScVal(value: unknown): value is xdr.ScVal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { switch?: unknown }).switch === 'function' &&
    typeof (value as { toXDR?: unknown }).toXDR === 'function'
  );
}

function decodeNative(
  value: xdr.ScVal
): { ok: true; native: unknown } | { ok: false; detail: string } {
  try {
    return { ok: true, native: scValToNative(value) };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Invoice ids are u64 on-chain; SQLite INTEGER and JS numbers are exact up to 2^53-1. */
export function toInvoiceId(native: unknown): number | null {
  if (typeof native === 'bigint') {
    if (native < 0n || native > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(native);
  }
  if (typeof native === 'number' && Number.isSafeInteger(native) && native >= 0) {
    return native;
  }
  return null;
}

export function decodeEvent(raw: unknown, now: number = Date.now()): DecodedEvent {
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'malformed', reason: 'not_an_object' };
  }
  const event = raw as Record<string, unknown>;

  if (
    typeof event.id !== 'string' ||
    event.id.length === 0 ||
    event.id.length > MAX_EVENT_ID_LENGTH
  ) {
    return { kind: 'malformed', reason: 'event_id_invalid' };
  }
  if (typeof event.ledger !== 'number' || !Number.isSafeInteger(event.ledger) || event.ledger < 0) {
    return { kind: 'malformed', reason: 'ledger_invalid' };
  }
  if (
    typeof event.ledgerClosedAt !== 'string' ||
    event.ledgerClosedAt.length === 0 ||
    event.ledgerClosedAt.length > MAX_LEDGER_CLOSED_AT_LENGTH
  ) {
    return { kind: 'malformed', reason: 'ledger_closed_at_invalid' };
  }

  if (event.topic === undefined || event.topic === null) {
    return { kind: 'ignored', reason: 'empty_topic' };
  }
  if (!Array.isArray(event.topic)) {
    return { kind: 'malformed', reason: 'topic_not_array' };
  }
  if (event.topic.length === 0) {
    return { kind: 'ignored', reason: 'empty_topic' };
  }
  const head = event.topic[0];
  if (!isScVal(head)) {
    return { kind: 'malformed', reason: 'topic_not_scval' };
  }
  const topic = decodeNative(head);
  if (!topic.ok) {
    return { kind: 'malformed', reason: 'topic_decode_failed', detail: topic.detail };
  }
  if (typeof topic.native !== 'string') {
    return { kind: 'malformed', reason: 'topic_not_symbol' };
  }
  if (!KNOWN_EVENT_TYPES.has(topic.native)) {
    return { kind: 'ignored', reason: 'unknown_topic' };
  }

  if (!isScVal(event.value)) {
    return { kind: 'malformed', reason: 'value_not_scval' };
  }
  const value = decodeNative(event.value);
  if (!value.ok) {
    return { kind: 'malformed', reason: 'value_decode_failed', detail: value.detail };
  }
  const invoiceId = toInvoiceId(value.native);
  if (invoiceId === null) {
    return { kind: 'malformed', reason: 'invoice_id_invalid', detail: typeof value.native };
  }

  return {
    kind: 'ok',
    event: {
      event_id: event.id,
      event_type: topic.native as ILNEventType,
      invoice_id: invoiceId,
      ledger: event.ledger,
      ledger_closed_at: event.ledgerClosedAt,
      created_at: now,
    },
  };
}

const INVOICE_STATUSES = new Set([
  'Pending',
  'PartiallyFunded',
  'Funded',
  'Paid',
  'Defaulted',
  'Appealed',
  'Disputed',
  'Expired',
  'Cancelled',
]);

/**
 * Shape check for the invoice state returned by the RPC before it reaches
 * SQLite. A malformed state used to throw from the named-parameter binding
 * after the event row had already been written, leaving the event marked as
 * processed with no invoice behind it.
 */
export function isValidInvoiceState(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const inv = value as Record<string, unknown>;
  const isAddress = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 128;
  return (
    Number.isSafeInteger(inv.id) &&
    (inv.id as number) >= 0 &&
    isAddress(inv.freelancer) &&
    isAddress(inv.payer) &&
    typeof inv.amount === 'string' &&
    /^\d+$/.test(inv.amount) &&
    Number.isFinite(inv.due_date) &&
    Number.isFinite(inv.discount_rate) &&
    typeof inv.status === 'string' &&
    INVOICE_STATUSES.has(inv.status) &&
    (inv.funder === null || isAddress(inv.funder)) &&
    (inv.funded_at === null || Number.isFinite(inv.funded_at))
  );
}

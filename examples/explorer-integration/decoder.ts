/**
 * ILN event decoder — converts raw Soroban contract event responses
 * into structured, human-readable ILN event objects.
 *
 * Works with the Soroban RPC `getEvents` response shape.
 * No build step required when used with ts-node or a bundler.
 */

import { scValToNative } from "@stellar/stellar-sdk";

export type ILNEventType = "submitted" | "funded" | "paid" | "defaulted";

export interface DecodedILNEvent {
  eventId: string;
  type: ILNEventType;
  invoiceId: number;
  ledger: number;
  ledgerClosedAt: string;
  /** Link to Stellar Expert for the ledger containing this event. */
  explorerUrl: string;
}

const KNOWN_TYPES = new Set<ILNEventType>([
  "submitted",
  "funded",
  "paid",
  "defaulted",
]);

const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer/testnet/ledger";

/**
 * Decode a single raw Soroban RPC event into a DecodedILNEvent.
 * Returns null if the event is not a recognised ILN event.
 */
export function decodeEvent(raw: {
  id: string;
  topic: unknown[];
  value: unknown;
  ledger: number;
  ledgerClosedAt: string;
}): DecodedILNEvent | null {
  if (!raw.topic?.length) return null;

  let eventType: string;
  let invoiceId: number;

  try {
    eventType = String(scValToNative(raw.topic[0] as Parameters<typeof scValToNative>[0]));
    invoiceId = Number(scValToNative(raw.value as Parameters<typeof scValToNative>[0]));
  } catch {
    return null;
  }

  if (!KNOWN_TYPES.has(eventType as ILNEventType)) return null;

  return {
    eventId: raw.id,
    type: eventType as ILNEventType,
    invoiceId,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
    explorerUrl: `${STELLAR_EXPERT_BASE}/${raw.ledger}`,
  };
}

/** Decode an array of raw RPC events, silently skipping unrecognised ones. */
export function decodeEvents(
  raws: Parameters<typeof decodeEvent>[0][]
): DecodedILNEvent[] {
  return raws.flatMap((r) => {
    const decoded = decodeEvent(r);
    return decoded ? [decoded] : [];
  });
}

// ── Human-readable formatting helpers ────────────────────────────────────────

const STROOPS_PER_UNIT = 10_000_000n;

/** Convert a stroops string to a decimal token amount string (e.g. "100.0000000"). */
export function stroopsToAmount(stroops: string): string {
  const val = BigInt(stroops);
  const whole = val / STROOPS_PER_UNIT;
  const frac = (val % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

/** Format a Unix timestamp as a locale date string. */
export function formatDate(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Shorten a Stellar address for display (e.g. "GABCD…WXYZ"). */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const STATUS_LABELS: Record<string, string> = {
  Pending: "🟡 Pending",
  Funded: "🔵 Funded",
  Paid: "🟢 Paid",
  Defaulted: "🔴 Defaulted",
};

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const EVENT_LABELS: Record<ILNEventType, string> = {
  submitted: "📄 Invoice Submitted",
  funded: "💰 Invoice Funded",
  paid: "✅ Invoice Paid",
  defaulted: "⚠️ Invoice Defaulted",
};

export function formatEventType(type: ILNEventType): string {
  return EVENT_LABELS[type] ?? type;
}

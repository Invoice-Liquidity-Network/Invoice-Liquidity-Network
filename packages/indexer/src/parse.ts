import { ParsedHorizonEvent } from './types';

export interface RawHorizonEvent {
  type: string;
  contract_id?: string;
  topics?: string[]; // base64-encoded XDR
  value?: string; // base64-encoded XDR
  paging_token?: string;
  ledger?: number;
  ledger_closed_at?: string;
  tx_hash?: string;
}

/**
 * Attempt to decode a base64 XDR string to a human-readable JS value.
 * Falls back to the raw string if decoding fails.
 */
function tryDecodeXdr(xdrBase64: string): unknown {
  try {
    // In the real SDK this would be:
    // import { xdr } from "@stellar/stellar-sdk";
    // return xdr.ScVal.fromXDR(xdrBase64, "base64").value();
    // For portability we return the raw value and let callers use the SDK.
    return xdrBase64;
  } catch {
    return xdrBase64;
  }
}

/**
 * parseContractEvent converts a raw Horizon event record into a typed
 * ParsedHorizonEvent. This is a thin adapter that mirrors the SDK's
 * parseContractEvent helper so the indexer can be tested without a live SDK.
 *
 * In a real integration this should import and delegate to:
 *   import { parseContractEvent } from "@iln/sdk";
 */
export function parseContractEvent(raw: RawHorizonEvent): ParsedHorizonEvent {
  return {
    contractId: raw.contract_id ?? '',
    type: raw.type ?? 'unknown',
    topics: (raw.topics ?? []).map(tryDecodeXdr),
    value: raw.value ? tryDecodeXdr(raw.value) : null,
    ledger: raw.ledger ?? 0,
    ledgerClosedAt: raw.ledger_closed_at ?? raw.ledger_closed_at ?? '',
    txHash: raw.tx_hash ?? '',
    pagingToken: raw.paging_token ?? '',
  };
}

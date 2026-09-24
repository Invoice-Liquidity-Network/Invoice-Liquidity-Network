/**
 * Lightweight ScVal <-> base64 XDR helpers used across the SDK for
 * validation, logging, and property-based fuzz coverage.
 */
import { scValToNative, xdr as stellarXdr } from '@stellar/stellar-sdk';
import { ValidationError } from './errors';

export type Readable =
  | string
  | boolean
  | number
  | null
  | Readable[]
  | { [key: string]: Readable };

function normalizeReadable(value: unknown): Readable {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeReadable);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex');
  }
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: Readable } = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalizeReadable(entry);
    }
    return out;
  }
  return value as Readable;
}

/**
 * Encode a ScVal into a base64 XDR string.
 */
export function encode(scVal: stellarXdr.ScVal): string {
  return scVal.toXDR('base64');
}

/**
 * Decode a base64 XDR string into a ScVal.
 *
 * @throws {ValidationError} If the payload is not valid ScVal XDR.
 */
export function decode(encoded: string): stellarXdr.ScVal {
  try {
    return stellarXdr.ScVal.fromXDR(encoded, 'base64');
  } catch (err) {
    throw new ValidationError('Invalid ScVal XDR', undefined, { cause: err });
  }
}

/**
 * Convert a ScVal into a JSON-safe, human-readable value (bigints become
 * strings, bytes become hex). Useful for logging decoded contract payloads.
 */
export function toReadable(scVal: stellarXdr.ScVal): Readable {
  return normalizeReadable(scValToNative(scVal));
}

/**
 * Namespace-style wrapper so callers can use `xdr.encode`, `xdr.decode`,
 * and `xdr.toReadable` uniformly.
 */
export const xdr = { encode, decode, toReadable };
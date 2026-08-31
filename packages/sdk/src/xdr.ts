import { scValToNative, xdr as stellarXdr } from '@stellar/stellar-sdk';

/**
 * A Stellar XDR Smart Contract Value.
 *
 * Represents any value that can be stored or returned by a Soroban smart contract,
 * including integers, strings, bytes, maps, and vectors. Re-exported from
 * `@stellar/stellar-sdk` for convenience.
 */
export type ScVal = stellarXdr.ScVal;

/**
 * Utilities for encoding, decoding, and inspecting Stellar XDR ScVal values.
 *
 * Provides a convenient interface for working with the raw XDR format used by
 * Soroban smart contract arguments and return values.
 */
export const xdr = {
  /**
   * Encodes a Stellar ScVal to its base64 XDR representation.
   *
   * @param value - The ScVal to encode.
   * @returns The base64-encoded XDR string.
   */
  encode(value: ScVal): string {
    return value.toXDR('base64');
  },

  /**
   * Decodes a base64 XDR string back into a Stellar ScVal.
   *
   * @param base64 - The base64-encoded XDR string to decode.
   * @returns The decoded ScVal.
   * @throws {Error} If the input is an empty string or not valid ScVal XDR.
   */
  decode(base64: string): ScVal {
    const trimmed = base64.trim();
    if (!trimmed) {
      throw new Error('XDR value must be a non-empty base64 string.');
    }

    try {
      return stellarXdr.ScVal.fromXDR(trimmed, 'base64');
    } catch (error) {
      throw new Error(
        `Invalid ScVal XDR: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  /**
   * Converts a Stellar ScVal to a plain JavaScript value for human-readable inspection.
   *
   * Recursively converts bigints to strings, Uint8Arrays to `{ bytes, hex }` objects,
   * Maps to plain objects, and other values to their native equivalents.
   *
   * @param scVal - The ScVal to convert.
   * @returns A plain JavaScript value representation of the ScVal.
   */
  toReadable(scVal: ScVal): unknown {
    return toReadableValue(scValToNative(scVal));
  },
};

function toReadableValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Uint8Array) {
    return {
      bytes: Array.from(value),
      hex: Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    };
  }

  if (Array.isArray(value)) {
    return value.map(toReadableValue);
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([key, mapValue]) => [formatKey(key), toReadableValue(mapValue)])
    );
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, objectValue]) => [
        key,
        toReadableValue(objectValue),
      ])
    );
  }

  return value;
}

function formatKey(key: unknown): string {
  if (typeof key === 'string') {
    return key;
  }

  if (typeof key === 'bigint') {
    return key.toString();
  }

  return JSON.stringify(toReadableValue(key));
}

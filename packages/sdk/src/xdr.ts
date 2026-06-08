import { scValToNative, xdr as stellarXdr } from "@stellar/stellar-sdk";

export type ScVal = stellarXdr.ScVal;

export const xdr = {
  encode(value: ScVal): string {
    return value.toXDR("base64");
  },

  decode(base64: string): ScVal {
    const trimmed = base64.trim();
    if (!trimmed) {
      throw new Error("XDR value must be a non-empty base64 string.");
    }

    try {
      return stellarXdr.ScVal.fromXDR(trimmed, "base64");
    } catch (error) {
      throw new Error(`Invalid ScVal XDR: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  toReadable(scVal: ScVal): unknown {
    return toReadableValue(scValToNative(scVal));
  },
};

function toReadableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Uint8Array) {
    return {
      bytes: Array.from(value),
      hex: Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    };
  }

  if (Array.isArray(value)) {
    return value.map(toReadableValue);
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([key, mapValue]) => [formatKey(key), toReadableValue(mapValue)]),
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, objectValue]) => [
        key,
        toReadableValue(objectValue),
      ]),
    );
  }

  return value;
}

function formatKey(key: unknown): string {
  if (typeof key === "string") {
    return key;
  }

  if (typeof key === "bigint") {
    return key.toString();
  }

  return JSON.stringify(toReadableValue(key));
}

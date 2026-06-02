import { StrKey } from "@stellar/stellar-sdk";

export function isValidGAddress(value: string): boolean {
  return typeof value === "string" && value.length > 0 && StrKey.isValidEd25519PublicKey(value);
}

export function isValidContractId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && StrKey.isValidContractId(value);
}

export function truncateAddress(value: string, chars = 4): string {
  if (typeof value !== "string") {
    throw new TypeError("Address must be a string");
  }

  if (chars < 1 || !Number.isInteger(chars)) {
    throw new TypeError("chars must be a positive integer");
  }

  if (value.length <= chars * 2 + 3) {
    return value;
  }

  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

export function formatAddress(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invalid Stellar public address or contract ID");
  }

  const address = value.trim();

  if (isValidGAddress(address)) {
    return StrKey.encodeEd25519PublicKey(StrKey.decodeEd25519PublicKey(address));
  }

  if (isValidContractId(address)) {
    return StrKey.encodeContractId(StrKey.decodeContractId(address));
  }

  throw new Error("Invalid Stellar public address or contract ID");
}

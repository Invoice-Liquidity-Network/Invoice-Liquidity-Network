import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  formatAddress,
  isValidContractId,
  isValidGAddress,
  truncateAddress,
} from "../src/address";

describe("address utility", () => {
  const validGAddress = Keypair.random().publicKey();
  const contractIdBytes = new Uint8Array(32).fill(1);
  const validContractId = StrKey.encodeContractId(Buffer.from(contractIdBytes));

  it("validates G-addresses", () => {
    expect(isValidGAddress(validGAddress)).toBe(true);
    expect(isValidGAddress(validContractId)).toBe(false);
    expect(isValidGAddress("")).toBe(false);
    expect(isValidGAddress("G1234INVALIDADDRESSABCDEF")).toBe(false);
  });

  it("validates contract IDs", () => {
    expect(isValidContractId(validContractId)).toBe(true);
    expect(isValidContractId(validGAddress)).toBe(false);
    expect(isValidContractId("")).toBe(false);
    expect(isValidContractId("C1234INVALIDCONTRACTIDABCDEF")).toBe(false);
  });

  it("formats valid addresses and contract IDs", () => {
    expect(formatAddress(validGAddress)).toBe(validGAddress);
    expect(formatAddress(validContractId)).toBe(validContractId);
  });

  it("throws for invalid formatAddress inputs", () => {
    expect(() => formatAddress("")).toThrow("Invalid Stellar public address or contract ID");
    expect(() => formatAddress("invalid-address")).toThrow(
      "Invalid Stellar public address or contract ID"
    );
  });

  it("truncates addresses with default length", () => {
    const truncated = truncateAddress(validGAddress);
    expect(truncated).toMatch(/^.{4}\.\.\..{4}$/);
    expect(truncated.startsWith(validGAddress.slice(0, 4))).toBe(true);
    expect(truncated.endsWith(validGAddress.slice(-4))).toBe(true);
  });

  it("returns the original string for short addresses", () => {
    expect(truncateAddress("G12", 2)).toBe("G12");
    expect(truncateAddress("ABC", 2)).toBe("ABC");
  });

  it("throws for invalid truncateAddress char values", () => {
    expect(() => truncateAddress(validGAddress, 0)).toThrow("chars must be a positive integer");
    expect(() => truncateAddress(validGAddress, -1)).toThrow("chars must be a positive integer");
  });
});

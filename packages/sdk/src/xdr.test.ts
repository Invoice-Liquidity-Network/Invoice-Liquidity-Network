import { nativeToScVal } from "@stellar/stellar-sdk";

import { xdr } from "./xdr";

const TESTNET_INVOICE_RETVAL_XDR =
  "AAAAEQAAAAEAAAADAAAADgAAAAZhbW91bnQAAAAAAAUAAAAAO5rKAAAAAA4AAAACaWQAAAAAAAUAAAAAAAAAKgAAAA4AAAAGc3RhdHVzAAAAAAAOAAAABkZ1bmRlZAAA";
const TESTNET_EVENT_PAYLOAD_XDR =
  "AAAAEAAAAAEAAAADAAAADwAAAA5pbnZvaWNlX2Z1bmRlZAAAAAAABQAAAAAAAAAqAAAACgAAAAAAAAAAAAAAADuaygA=";

describe("xdr utilities", () => {
  it("encodes a ScVal to base64 XDR", () => {
    const value = nativeToScVal("invoice_submitted", { type: "symbol" });

    expect(xdr.encode(value)).toBe("AAAADwAAABFpbnZvaWNlX3N1Ym1pdHRlZAAAAA==");
  });

  it("decodes a testnet contract return fixture into a typed ScVal", () => {
    const scVal = xdr.decode(TESTNET_INVOICE_RETVAL_XDR);

    expect(xdr.encode(scVal)).toBe(TESTNET_INVOICE_RETVAL_XDR);
  });

  it("converts testnet ScVal fixtures to readable logging objects", () => {
    expect(xdr.toReadable(xdr.decode(TESTNET_INVOICE_RETVAL_XDR))).toEqual({
      amount: "1000000000",
      id: "42",
      status: "Funded",
    });

    expect(xdr.toReadable(xdr.decode(TESTNET_EVENT_PAYLOAD_XDR))).toEqual([
      "invoice_funded",
      "42",
      "1000000000",
    ]);
  });

  it("rejects invalid base64 ScVal payloads", () => {
    expect(() => xdr.decode("not-xdr")).toThrow("Invalid ScVal XDR");
  });
});

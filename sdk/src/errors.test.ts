import { describe, it, expect } from "vitest";
import { parseContractError, InvalidDiscountRateError, TokenMismatchError, PayerReputationTooLowError, GenericContractError } from "./errors";

describe("Error Mapping SDK", () => {
  it("maps InvalidDiscountRate", () => {
    const err = parseContractError("Error: InvalidDiscountRate");
    expect(err).toBeInstanceOf(InvalidDiscountRateError);
    expect(err.code).toBe("INVALID_DISCOUNT_RATE");
  });
  it("maps TokenMismatch", () => {
    const err = parseContractError("Error: TokenMismatch");
    expect(err).toBeInstanceOf(TokenMismatchError);
  });
  it("maps PayerReputationTooLow", () => {
    const err = parseContractError("Error: PayerReputationTooLow");
    expect(err).toBeInstanceOf(PayerReputationTooLowError);
  });
  it("maps generic errors", () => {
    const err = parseContractError("UnknownXDRCode");
    expect(err).toBeInstanceOf(GenericContractError);
  });
});

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { formatAmount, parseAmount, type AmountToken } from "../../../../sdk/src/amounts";

const PROPERTY_RUNS = 50_000;
const MAX_SAFE_AMOUNT = 10n ** 30n;

describe("SDK amount property tests", () => {
  it("roundtrips parseAmount(formatAmount(x, token), token) for random token decimals", () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(parseAmount(formatAmount(amount, token), token)).toBe(amount);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it("never formats non-negative amounts as negative values", () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(formatAmount(amount, token).startsWith("-")).toBe(false);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it("always formats exactly the token decimal places", () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        const formatted = formatAmount(amount, token);
        const [, fraction = ""] = formatted.split(".");

        expect(fraction.length).toBe(token.decimals);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it("parses bounded random decimal strings without overflowing BigInt", () => {
    fc.assert(
      fc.property(decimalStringArbitrary(), tokenArbitrary(), ({ whole, fraction }, token) => {
        const normalizedFraction = fraction.slice(0, token.decimals);
        const value = token.decimals === 0
          ? whole
          : `${whole}.${normalizedFraction.padEnd(token.decimals, "0")}`;

        const parsed = parseAmount(value, token);

        expect(parsed).toBeGreaterThanOrEqual(0n);
        const scale = 10n ** BigInt(token.decimals);
        expect(parsed).toBeLessThanOrEqual(BigInt(whole) * scale + scale - 1n);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

function amountArbitrary(): fc.Arbitrary<bigint> {
  return fc.bigInt({ max: MAX_SAFE_AMOUNT, min: 0n });
}

function tokenArbitrary(): fc.Arbitrary<AmountToken> {
  return fc.integer({ max: 18, min: 0 }).map((decimals) => ({ decimals }));
}

function decimalStringArbitrary(): fc.Arbitrary<{ fraction: string; whole: string }> {
  return fc.record({
    fraction: fc.array(fc.integer({ max: 9, min: 0 }), { maxLength: 18 })
      .map((digits) => digits.join("")),
    whole: fc.bigInt({ max: MAX_SAFE_AMOUNT, min: 0n }).map((value) => value.toString()),
  });
}

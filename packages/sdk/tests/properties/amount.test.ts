import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  formatAmount,
  formatAmountTrimmed,
  parseAmount,
  validateAmount,
  hasExcessPrecision,
  clampToTokenDecimals,
  applyBasisPoints,
  scaledMultiply,
  addAmounts,
  subtractAmounts,
  BigAmount,
  type AmountToken,
} from '../../../../sdk/src/amounts';

const PROPERTY_RUNS = 50_000;
const MAX_SAFE_AMOUNT = 10n ** 30n;

describe('SDK amount property tests', () => {
  it('roundtrips parseAmount(formatAmount(x, token), token) for random token decimals', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(parseAmount(formatAmount(amount, token), token)).toBe(amount);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('never formats non-negative amounts as negative values', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(formatAmount(amount, token).startsWith('-')).toBe(false);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('always formats exactly the token decimal places', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        const formatted = formatAmount(amount, token);
        const [, fraction = ''] = formatted.split('.');

        expect(fraction.length).toBe(token.decimals);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('parses bounded random decimal strings without overflowing BigInt', () => {
    fc.assert(
      fc.property(decimalStringArbitrary(), tokenArbitrary(), ({ whole, fraction }, token) => {
        const normalizedFraction = fraction.slice(0, token.decimals);
        const value =
          token.decimals === 0
            ? whole
            : `${whole}.${normalizedFraction.padEnd(token.decimals, '0')}`;

        const parsed = parseAmount(value, token);

        expect(parsed).toBeGreaterThanOrEqual(0n);
        const scale = 10n ** BigInt(token.decimals);
        expect(parsed).toBeLessThanOrEqual(BigInt(whole) * scale + scale - 1n);
      }),
      { numRuns: PROPERTY_RUNS }
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
    fraction: fc
      .array(fc.integer({ max: 9, min: 0 }), { maxLength: 18 })
      .map((digits) => digits.join('')),
    whole: fc.bigInt({ max: MAX_SAFE_AMOUNT, min: 0n }).map((value) => value.toString()),
  });
}

// ── BigAmount class ───────────────────────────────────────────────────────────

describe('BigAmount class', () => {
  it('BigAmount.parse(BigAmount.from(x).format()) roundtrips', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        const a = BigAmount.from(amount, token);
        expect(BigAmount.parse(a.format(), token).toRaw()).toBe(amount);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('add is commutative: a.add(b).toRaw() === b.add(a).toRaw()', () => {
    fc.assert(
      fc.property(amountArbitrary(), amountArbitrary(), tokenArbitrary(), (x, y, token) => {
        const a = BigAmount.from(x, token);
        const b = BigAmount.from(y, token);
        expect(a.add(b).toRaw()).toBe(b.add(a).toRaw());
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('applyBasisPoints(0) is always zero', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(BigAmount.from(amount, token).applyBasisPoints(0).toRaw()).toBe(0n);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('applyBasisPoints(10_000) equals original amount', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(BigAmount.from(amount, token).applyBasisPoints(10_000).toRaw()).toBe(amount);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('subtract(a, a) is always zero', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        const a = BigAmount.from(amount, token);
        expect(a.subtract(a).toRaw()).toBe(0n);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('compare is consistent with numeric order', () => {
    fc.assert(
      fc.property(amountArbitrary(), amountArbitrary(), tokenArbitrary(), (x, y, token) => {
        const a = BigAmount.from(x, token);
        const b = BigAmount.from(y, token);
        const cmp = a.compare(b);
        if (x < y) expect(cmp).toBe(-1);
        else if (x > y) expect(cmp).toBe(1);
        else expect(cmp).toBe(0);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('isZero() is true only for 0n', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(BigAmount.from(amount, token).isZero()).toBe(amount === 0n);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });
});

// ── validateAmount ────────────────────────────────────────────────────────────

describe('validateAmount', () => {
  it('valid = true for any output of formatAmount', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        const formatted = formatAmount(amount, token);
        expect(validateAmount(formatted, token).valid).toBe(true);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('valid = false for inputs with more decimal places than the token supports', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 17 }).chain((decimals) =>
          fc.record({
            token: fc.constant({ decimals }),
            extra: fc
              .integer({ min: 1, max: 18 - decimals })
              .map((n) => '1.' + '1'.repeat(decimals + n)),
          })
        ),
        ({ token, extra }) => {
          expect(validateAmount(extra, token).valid).toBe(false);
        }
      ),
      { numRuns: 10_000 }
    );
  });

  it('valid = false for non-numeric strings', () => {
    const bad = ['', 'abc', '1.2.3', '-1', '1,000', 'NaN', '1e5'];
    for (const s of bad) {
      expect(validateAmount(s, { decimals: 6 }).valid).toBe(false);
    }
  });
});

// ── hasExcessPrecision ────────────────────────────────────────────────────────

describe('hasExcessPrecision', () => {
  it('false for any output of formatAmountTrimmed', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        const trimmed = formatAmountTrimmed(amount, token);
        expect(hasExcessPrecision(trimmed, token)).toBe(false);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('true when fraction length strictly exceeds token.decimals', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 17 }).chain((decimals) =>
          fc.record({
            token: fc.constant({ decimals }),
            extra: fc
              .integer({ min: 1, max: 18 - decimals })
              .map((n) => '0.' + '1'.repeat(decimals + n)),
          })
        ),
        ({ token, extra }) => {
          expect(hasExcessPrecision(extra, token)).toBe(true);
        }
      ),
      { numRuns: 10_000 }
    );
  });
});

// ── clampToTokenDecimals ──────────────────────────────────────────────────────

describe('clampToTokenDecimals', () => {
  it('is idempotent: clamp(clamp(x)) === clamp(x)', () => {
    fc.assert(
      fc.property(decimalStringArbitrary(), tokenArbitrary(), ({ whole, fraction }, token) => {
        const display = `${whole}.${fraction}`;
        const once = clampToTokenDecimals(display, token);
        expect(clampToTokenDecimals(once, token)).toBe(once);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('parseAmount(clampToTokenDecimals(x)) never throws', () => {
    fc.assert(
      fc.property(decimalStringArbitrary(), tokenArbitrary(), ({ whole, fraction }, token) => {
        const display = `${whole}.${fraction}`;
        const clamped = clampToTokenDecimals(display, token);
        expect(() => parseAmount(clamped, token)).not.toThrow();
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });
});

// ── applyBasisPoints ──────────────────────────────────────────────────────────

describe('applyBasisPoints (standalone)', () => {
  it('applyBasisPoints(amount, 10_000) === amount', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(applyBasisPoints(amount, 10_000, token)).toBe(amount);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('applyBasisPoints(amount, 0) === 0n', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(applyBasisPoints(amount, 0, token)).toBe(0n);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('is monotone: larger bps → result >= smaller bps result', () => {
    fc.assert(
      fc.property(
        amountArbitrary(),
        tokenArbitrary(),
        fc.integer({ min: 0, max: 9_999 }),
        fc.integer({ min: 1, max: 10_000 }),
        (amount, token, low, highDelta) => {
          const high = Math.min(low + highDelta, 10_000);
          expect(applyBasisPoints(amount, high, token)).toBeGreaterThanOrEqual(
            applyBasisPoints(amount, low, token)
          );
        }
      ),
      { numRuns: PROPERTY_RUNS }
    );
  });
});

// ── scaledMultiply ────────────────────────────────────────────────────────────

describe('scaledMultiply', () => {
  it('scaledMultiply(amount, d, d) === amount (identity when n === d)', () => {
    fc.assert(
      fc.property(
        amountArbitrary(),
        tokenArbitrary(),
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        (amount, token, d) => {
          expect(scaledMultiply(amount, d, d, token)).toBe(amount);
        }
      ),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('scaledMultiply(0n, any, any) === 0n', () => {
    fc.assert(
      fc.property(
        tokenArbitrary(),
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        (token, num, den) => {
          expect(scaledMultiply(0n, num, den, token)).toBe(0n);
        }
      ),
      { numRuns: PROPERTY_RUNS }
    );
  });
});

// ── addAmounts / subtractAmounts ──────────────────────────────────────────────

describe('addAmounts / subtractAmounts', () => {
  it('addAmounts is commutative', () => {
    fc.assert(
      fc.property(amountArbitrary(), amountArbitrary(), tokenArbitrary(), (a, b, token) => {
        expect(addAmounts(a, b, token)).toBe(addAmounts(b, a, token));
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('subtractAmounts(a, a) === 0n', () => {
    fc.assert(
      fc.property(amountArbitrary(), tokenArbitrary(), (amount, token) => {
        expect(subtractAmounts(amount, amount, token)).toBe(0n);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });

  it('addAmounts then subtractAmounts roundtrips', () => {
    fc.assert(
      fc.property(amountArbitrary(), amountArbitrary(), tokenArbitrary(), (a, b, token) => {
        expect(subtractAmounts(addAmounts(a, b, token), b, token)).toBe(a);
      }),
      { numRuns: PROPERTY_RUNS }
    );
  });
});

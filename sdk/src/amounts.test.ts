import { describe, expect, it } from 'vitest';
import {
  BigAmount,
  formatAmount,
  formatAmountOptions,
  formatAmountTrimmed,
  parseAmount,
} from './amounts';

describe('formatAmount', () => {
  it('formats a whole-unit amount without a fractional part', () => {
    expect(formatAmount(100_000_000n, { decimals: 6 })).toBe('100');
  });

  it('trims trailing fractional zeros', () => {
    expect(formatAmount(12_500_000n, { decimals: 6 })).toBe('12.5');
    expect(formatAmount(123_456_789n, { decimals: 6 })).toBe('123.456789');
  });

  it('round-trips parseAmount <-> formatAmount', () => {
    expect(formatAmount(parseAmount('123.456789', { decimals: 7 }), { decimals: 7 })).toBe(
      '123.456789'
    );
    expect(formatAmount(parseAmount('1000', { decimals: 6 }), { decimals: 6 })).toBe('1000');
  });

  it('handles fractional values with all-zero fraction as whole units', () => {
    expect(formatAmount(0n, { decimals: 6 })).toBe('0');
    expect(formatAmount(1n, { decimals: 0 })).toBe('1');
  });
});

describe('formatAmountOptions', () => {
  it('pads by default and trims when requested', () => {
    const amount = 100_000_000n;
    expect(formatAmountOptions(amount, { decimals: 6 }, {})).toBe('100.000000');
    expect(formatAmountOptions(amount, { decimals: 6 }, { trimZeros: true })).toBe('100');
  });

  it('marks all-zero fractional values as whole units', () => {
    expect(formatAmountOptions(5n, { decimals: 0 }, {})).toBe('5');
  });
});

describe('BigAmount.format', () => {
  it('delegates to formatAmount when no options are supplied', () => {
    expect(BigAmount.from(100_000_000n, { decimals: 6 }).format()).toBe('100');
  });

  it('supports trimming via explicit options', () => {
    expect(BigAmount.parse('0.5', { decimals: 6 }).format({ trimZeros: true })).toBe('0.5');
  });
});

describe('formatAmountTrimmed', () => {
  it('trims trailing fractional zeros', () => {
    expect(formatAmountTrimmed(1_000_000n, { decimals: 6 })).toBe('1');
    expect(formatAmountTrimmed(1_250_000n, { decimals: 6 })).toBe('1.25');
  });
});

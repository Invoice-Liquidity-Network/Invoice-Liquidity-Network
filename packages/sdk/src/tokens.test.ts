import {
  SUPPORTED_TOKENS,
  formatAmount,
  parseAmount,
  isValidToken,
  getToken,
  type Token,
} from './tokens';

const XLM = SUPPORTED_TOKENS.testnet.find((t) => t.symbol === 'XLM') as Token;
const USDC = SUPPORTED_TOKENS.testnet.find((t) => t.symbol === 'USDC') as Token;
const EURC = SUPPORTED_TOKENS.mainnet.find((t) => t.symbol === 'EURC') as Token;

describe('SUPPORTED_TOKENS registry', () => {
  it('exposes testnet and mainnet token lists', () => {
    expect(SUPPORTED_TOKENS.testnet.length).toBe(3);
    expect(SUPPORTED_TOKENS.mainnet.length).toBe(3);
  });

  it('uses 7 decimals for XLM and 6 for stablecoins', () => {
    expect(XLM.decimals).toBe(7);
    expect(USDC.decimals).toBe(6);
    expect(EURC.decimals).toBe(6);
  });

  it('has a logo and a C... contract address for every token', () => {
    for (const list of [SUPPORTED_TOKENS.testnet, SUPPORTED_TOKENS.mainnet]) {
      for (const token of list) {
        expect(token.logo).toMatch(/\.svg$/);
        expect(token.address).toMatch(/^C[A-Z0-9]{55}$/);
      }
    }
  });
});

describe('formatAmount', () => {
  it('formats zero as "0" regardless of decimals', () => {
    expect(formatAmount(0n, XLM)).toBe('0');
    expect(formatAmount(0n, USDC)).toBe('0');
  });

  it('formats the smallest unit (boundary) correctly', () => {
    expect(formatAmount(1n, XLM)).toBe('0.0000001'); // 1 stroop
    expect(formatAmount(1n, USDC)).toBe('0.000001');
  });

  it('formats whole units without a decimal point', () => {
    expect(formatAmount(10_000_000n, XLM)).toBe('1');
    expect(formatAmount(1_000_000n, USDC)).toBe('1');
  });

  it('trims trailing zeros in the fractional part', () => {
    expect(formatAmount(12_345_670n, XLM)).toBe('1.234567');
    expect(formatAmount(1_500_000n, USDC)).toBe('1.5');
  });

  it('preserves full XLM 7-decimal precision', () => {
    expect(formatAmount(12_345_678n, XLM)).toBe('1.2345678');
  });

  it('handles negative amounts', () => {
    expect(formatAmount(-1n, USDC)).toBe('-0.000001');
    expect(formatAmount(-1_000_000n, USDC)).toBe('-1');
  });

  it('handles very large amounts beyond Number.MAX_SAFE_INTEGER', () => {
    expect(formatAmount(123_456_789_012_345_678n, USDC)).toBe('123456789012.345678');
  });
});

describe('parseAmount', () => {
  it('parses whole numbers', () => {
    expect(parseAmount('1', USDC)).toBe(1_000_000n);
    expect(parseAmount('1', XLM)).toBe(10_000_000n);
  });

  it('parses the smallest representable unit (boundary)', () => {
    expect(parseAmount('0.0000001', XLM)).toBe(1n);
    expect(parseAmount('0.000001', USDC)).toBe(1n);
  });

  it('parses fractional values with full precision', () => {
    expect(parseAmount('1.2345678', XLM)).toBe(12_345_678n);
    expect(parseAmount('1.5', USDC)).toBe(1_500_000n);
  });

  it('parses zero forms', () => {
    expect(parseAmount('0', XLM)).toBe(0n);
    expect(parseAmount('0.0', USDC)).toBe(0n);
  });

  it('trims surrounding whitespace', () => {
    expect(parseAmount('  2.5  ', USDC)).toBe(2_500_000n);
  });

  it('parses negative values', () => {
    expect(parseAmount('-1.000001', USDC)).toBe(-1_000_001n);
  });

  it('is the inverse of formatAmount (round-trip)', () => {
    for (const value of [0n, 1n, 999_999n, 12_345_678n, 10_000_000n]) {
      expect(parseAmount(formatAmount(value, XLM), XLM)).toBe(value);
    }
  });

  it('rejects excess precision rather than truncating', () => {
    expect(() => parseAmount('1.1234567', USDC)).toThrow(RangeError); // 7 > 6
    expect(() => parseAmount('1.123456', USDC)).not.toThrow(); // exactly 6 is allowed
  });

  it('rejects XLM values with more than 7 decimals (boundary + 1)', () => {
    expect(() => parseAmount('1.12345678', XLM)).toThrow(RangeError);
    expect(() => parseAmount('1.1234567', XLM)).not.toThrow();
  });

  it('throws on malformed input', () => {
    expect(() => parseAmount('', USDC)).toThrow(RangeError);
    expect(() => parseAmount('abc', USDC)).toThrow(RangeError);
    expect(() => parseAmount('1.2.3', USDC)).toThrow(RangeError);
    expect(() => parseAmount('1,000', USDC)).toThrow(RangeError);
    expect(() => parseAmount('.5', USDC)).toThrow(RangeError);
  });
});

describe('isValidToken', () => {
  it('returns true for supported testnet and mainnet addresses', () => {
    expect(isValidToken(XLM.address)).toBe(true);
    expect(isValidToken(EURC.address)).toBe(true);
  });

  it('returns false for unknown or malformed addresses', () => {
    expect(isValidToken('CNOPE')).toBe(false);
    expect(isValidToken('')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isValidToken(XLM.address.toLowerCase())).toBe(false);
  });
});

describe('getToken', () => {
  it('looks up a token across all networks by default', () => {
    expect(getToken(XLM.address)?.symbol).toBe('XLM');
  });

  it('constrains the lookup to a single network when given', () => {
    const mainnetUsdc = SUPPORTED_TOKENS.mainnet.find((t) => t.symbol === 'USDC') as Token;
    expect(getToken(mainnetUsdc.address, 'mainnet')?.symbol).toBe('USDC');
    expect(getToken(mainnetUsdc.address, 'testnet')).toBeUndefined();
  });

  it('returns undefined for unknown addresses', () => {
    expect(getToken('CUNKNOWN')).toBeUndefined();
  });
});

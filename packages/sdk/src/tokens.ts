/**
 * Multi-token support for the Invoice Liquidity Network SDK.
 *
 * Provides a canonical {@link Token} type, the {@link SUPPORTED_TOKENS} registry
 * for testnet and mainnet, and a small set of helpers for converting between
 * on-chain integer amounts (stroops / base units, expressed as `bigint`) and
 * human-readable decimal strings.
 *
 * All helpers handle XLM's 7-decimal precision and the 6-decimal stablecoins
 * (USDC / EURC) uniformly by reading the per-token `decimals` field, so callers
 * never hard-code a scale factor.
 */

/**
 * A canonical, fully-described token recognised by the protocol.
 *
 * Intentionally differs from @iln/shared's Token: this SDK version is a
 * UI/display-oriented representation with `logo` (asset path), literal union
 * `symbol` (`'USDC' | 'EURC' | 'XLM'`), and constrained `decimals` (`6 | 7`).
 * The shared version is a contract-level type with `name`, `issuer`, `listed`,
 * and unconstrained `symbol`/`decimals` fields.
 */
export interface Token {
  /** Stellar Asset Contract (SAC) address, `C...` for issued assets. */
  address: string;
  /** Ticker symbol. */
  symbol: 'USDC' | 'EURC' | 'XLM';
  /** Number of decimal places in the smallest unit. XLM uses 7, stablecoins 6. */
  decimals: 6 | 7;
  /** Path/URL to the token logo asset. */
  logo: string;
}

/** Network identifiers for the {@link SUPPORTED_TOKENS} registry. */
export type Network = 'testnet' | 'mainnet';

/**
 * Canonical token registry, keyed by network.
 *
 * The native XLM entries use the well-known Stellar Asset Contract addresses
 * for the native asset. USDC / EURC use the issuer SAC addresses for each
 * network. Addresses are upper-case `C...` contract IDs as used by Soroban.
 */
export const SUPPORTED_TOKENS: Record<Network, readonly Token[]> = {
  testnet: [
    {
      address: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      symbol: 'XLM',
      decimals: 7,
      logo: '/tokens/xlm.svg',
    },
    {
      address: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
      symbol: 'USDC',
      decimals: 6,
      logo: '/tokens/usdc.svg',
    },
    {
      address: 'CCBINL4TCQVEQN2Q2GO66RS4CWUARIECZEJA7JVYQO3GVF4LG6HJN236',
      symbol: 'EURC',
      decimals: 6,
      logo: '/tokens/eurc.svg',
    },
  ],
  mainnet: [
    {
      address: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
      symbol: 'XLM',
      decimals: 7,
      logo: '/tokens/xlm.svg',
    },
    {
      address: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
      symbol: 'USDC',
      decimals: 6,
      logo: '/tokens/usdc.svg',
    },
    {
      address: 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV',
      symbol: 'EURC',
      decimals: 6,
      logo: '/tokens/eurc.svg',
    },
  ],
} as const;

/** Flat list of every supported token across all networks. */
const ALL_TOKENS: readonly Token[] = [...SUPPORTED_TOKENS.testnet, ...SUPPORTED_TOKENS.mainnet];

/**
 * Format an on-chain integer `amount` (base units) as a human-readable decimal
 * string for the given `token`.
 *
 * Trailing zeros in the fractional part are trimmed, and the decimal point is
 * dropped entirely for whole amounts. Negative amounts are preserved.
 *
 * @example
 * formatAmount(12_345_670n, XLM)  // "1.234567"  (7 decimals)
 * formatAmount(1_000_000n, USDC)  // "1"          (6 decimals)
 */
export function formatAmount(amount: bigint, token: Token): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(token.decimals);

  const whole = abs / scale;
  const fraction = abs % scale;

  let result: string;
  if (fraction === 0n) {
    result = whole.toString();
  } else {
    const fractionStr = fraction.toString().padStart(token.decimals, '0').replace(/0+$/, '');
    result = `${whole.toString()}.${fractionStr}`;
  }

  return negative ? `-${result}` : result;
}

/**
 * Parse a human-readable decimal `display` string into an on-chain integer
 * amount (base units) for the given `token`.
 *
 * Accepts an optional leading `-`, an integer part, and an optional fractional
 * part. The fractional part must not exceed the token's `decimals` (excess
 * precision is rejected rather than silently truncated). Throws `RangeError`
 * for malformed input.
 *
 * @example
 * parseAmount("1.234567", XLM)  // 12_345_670n
 * parseAmount("1", USDC)        // 1_000_000n
 */
export function parseAmount(display: string, token: Token): bigint {
  const trimmed = display.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new RangeError(`Invalid amount "${display}" for ${token.symbol}`);
  }

  const [, sign, wholePart, fractionPart = ''] = match;
  if (fractionPart.length > token.decimals) {
    throw new RangeError(
      `Amount "${display}" has more than ${token.decimals} decimal places for ${token.symbol}`
    );
  }

  const scale = 10n ** BigInt(token.decimals);
  const paddedFraction = fractionPart.padEnd(token.decimals, '0');
  const value = BigInt(wholePart) * scale + BigInt(paddedFraction || '0');

  return sign === '-' ? -value : value;
}

/**
 * Return `true` if `address` corresponds to a supported token on any network.
 * Comparison is exact (case-sensitive) against contract IDs in
 * {@link SUPPORTED_TOKENS}.
 */
export function isValidToken(address: string): boolean {
  return ALL_TOKENS.some((token) => token.address === address);
}

/**
 * Look up a {@link Token} by address, optionally constrained to a single
 * `network`. Returns `undefined` when no match is found.
 */
export function getToken(address: string, network?: Network): Token | undefined {
  const pool = network ? SUPPORTED_TOKENS[network] : ALL_TOKENS;
  return pool.find((token) => token.address === address);
}

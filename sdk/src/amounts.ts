/**
 * Token decimal configuration for amount parsing and formatting.
 *
 * @property decimals - Number of decimal places the token supports (0-18).
 */
export interface AmountToken {
  decimals: number;
}

export interface FormatOptions {
  /** Trim trailing fractional zeros. Default: false. */
  trimZeros?: boolean;
  /** Append a token symbol after the number, e.g. "USDC". */
  symbol?: string;
  /** Abbreviate large values: 1_200_000 → "1.2M", 1_500 → "1.5K". */
  compact?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const MAX_DECIMALS = 18;
const BASIS_POINTS_SCALE = 10_000n;

// ── Core parse / format ───────────────────────────────────────────────────────

/**
 * Parse a human-readable amount string into the smallest token unit (bigint).
 *
 * @param input - The amount string (e.g. "100", "12.5", "0.001").
 * @param token - Token configuration specifying the number of decimal places.
 * @returns The amount in the smallest token unit as a bigint.
 * @throws {Error} If the input is not a valid non-negative decimal value.
 * @throws {Error} If the input has more decimal places than the token supports.
 *
 * @example
 * ```ts
 * // USDC has 6 decimals
 * parseAmount("100", { decimals: 6 });   // => 100000000n
 * parseAmount("12.5", { decimals: 6 }); // => 12500000n
 * parseAmount("0.001", { decimals: 6 }); // => 1000n
 * ```
 */
export function parseAmount(input: string, token: AmountToken): bigint {
  const decimals = normalizeDecimals(token);
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) {
    throw new Error('Invalid amount. Use a non-negative decimal value.');
  }

  const fraction = match[2] ?? '';
  if (fraction.length > decimals) {
    throw new Error(`Invalid amount. Token supports at most ${decimals} decimal places.`);
  }

  const whole = BigInt(match[1]);
  const fractional = BigInt(fraction.padEnd(decimals, '0') || '0');
  return whole * 10n ** BigInt(decimals) + fractional;
}

/**
 * Format a bigint amount from the smallest token unit into a human-readable string.
 *
 * @param amount - The amount in the smallest token unit.
 * @param token - Token configuration specifying the number of decimal places.
 * @returns A decimal string representation of the amount.
 * @throws {Error} If the amount is negative.
 *
 * @example
 * ```ts
 * // USDC has 6 decimals
 * formatAmount(100000000n, { decimals: 6 }); // => "100"
 * formatAmount(12500000n, { decimals: 6 });  // => "12.5"
 * ```
 */
export function formatAmount(amount: bigint, token: AmountToken): string {
  if (amount < 0n) {
    throw new Error('Cannot format a negative amount.');
  }

  const decimals = normalizeDecimals(token);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;

  if (decimals === 0) {
    return whole.toString();
  }

  const fraction = (amount % scale).toString().padStart(decimals, '0');
  return `${whole.toString()}.${fraction}`;
}

// ── Enhanced formatting ───────────────────────────────────────────────────────

/**
 * Format an amount with display options (trimming, symbol, compact notation).
 * Does not modify the existing `formatAmount` signature.
 */
export function formatAmountOptions(
  amount: bigint,
  token: AmountToken,
  opts: FormatOptions
): string {
  if (amount < 0n) {
    throw new Error('Cannot format a negative amount.');
  }

  const decimals = normalizeDecimals(token);
  const scale = 10n ** BigInt(decimals);

  let result: string;

  if (opts.compact) {
    result = formatCompact(amount, decimals, scale);
  } else {
    const whole = amount / scale;
    if (decimals === 0) {
      result = whole.toString();
    } else {
      let fraction = (amount % scale).toString().padStart(decimals, '0');
      if (opts.trimZeros) {
        fraction = fraction.replace(/0+$/, '');
      }
      result = fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
    }
  }

  return opts.symbol ? `${result} ${opts.symbol}` : result;
}

/**
 * Format trimming all trailing fractional zeros.
 * `1_000_000n` with 6 decimals → `"1"`, not `"1.000000"`.
 */
export function formatAmountTrimmed(amount: bigint, token: AmountToken): string {
  return formatAmountOptions(amount, token, { trimZeros: true });
}

/**
 * Format with the token symbol appended.
 * `1_000_000n` USDC → `"1.000000 USDC"`.
 */
export function formatAmountWithSymbol(
  amount: bigint,
  token: AmountToken & { symbol: string }
): string {
  return formatAmountOptions(amount, token, { symbol: token.symbol });
}

// ── Precision validation ──────────────────────────────────────────────────────

/**
 * Validate a display string without throwing. Returns `{ valid: true }` on
 * success or `{ valid: false, error: "..." }` with a human-readable message.
 */
export function validateAmount(input: string, token: AmountToken): ValidationResult {
  try {
    normalizeDecimals(token);
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Invalid token.' };
  }

  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return { valid: false, error: 'Invalid amount. Use a non-negative decimal value.' };
  }

  const fraction = match[2] ?? '';
  if (fraction.length > token.decimals) {
    return {
      valid: false,
      error: `Invalid amount. Token supports at most ${token.decimals} decimal places.`,
    };
  }

  return { valid: true };
}

/**
 * Return `true` if the display string has more fractional digits than the
 * token supports.
 */
export function hasExcessPrecision(display: string, token: AmountToken): boolean {
  const trimmed = display.trim();
  const match = trimmed.match(/^-?(\d+)(?:\.(\d+))?$/);
  if (!match) return false;
  const fraction = match[2] ?? '';
  return fraction.length > token.decimals;
}

/**
 * Truncate (not round) excess decimal places to fit the token.
 * Returns the input unchanged when precision is already within bounds.
 * Never throws.
 */
export function clampToTokenDecimals(display: string, token: AmountToken): string {
  // Normalize a trailing decimal point ("0." → "0") before matching.
  const trimmed = display.trim().replace(/\.$/, '');
  const match = trimmed.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return trimmed;

  const [, sign, whole, fraction = ''] = match;
  if (fraction.length <= token.decimals) return trimmed;

  const clamped = fraction.slice(0, token.decimals);
  const base = clamped.length > 0 ? `${whole}.${clamped}` : whole;
  return sign ? `${sign}${base}` : base;
}

// ── Conversion utilities ──────────────────────────────────────────────────────

/**
 * Apply a basis-point rate to an amount: `amount * bps / 10_000`.
 * Uses integer-only arithmetic (remainder truncated), matching Soroban contract behavior.
 */
export function applyBasisPoints(amount: bigint, bps: number, token: AmountToken): bigint {
  normalizeDecimals(token);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error('Basis points must be an integer between 0 and 10,000.');
  }
  return (amount * BigInt(bps)) / BASIS_POINTS_SCALE;
}

/**
 * Add two amounts expressed in the same token's base units.
 * Throws if the token decimals differ to prevent silent unit mismatch.
 */
export function addAmounts(a: bigint, b: bigint, token: AmountToken): bigint {
  normalizeDecimals(token);
  return a + b;
}

/**
 * Subtract `b` from `a` in the same token's base units.
 * The result may be negative; callers are responsible for asserting non-negativity.
 */
export function subtractAmounts(a: bigint, b: bigint, token: AmountToken): bigint {
  normalizeDecimals(token);
  return a - b;
}

/**
 * Multiply an amount by `numerator / denominator` using bigint intermediate math.
 * Remainder is truncated (floor division), matching Soroban contract behavior.
 *
 * @example
 * // Prorate 1 000 000 USDC by 30 of 90 days
 * scaledMultiply(1_000_000n, 30n, 90n, usdc) // → 333_333n
 */
export function scaledMultiply(
  amount: bigint,
  numerator: bigint,
  denominator: bigint,
  token: AmountToken
): bigint {
  normalizeDecimals(token);
  if (denominator === 0n) {
    throw new Error('scaledMultiply: denominator must not be zero.');
  }
  return (amount * numerator) / denominator;
}

// ── BigAmount class ───────────────────────────────────────────────────────────

/**
 * Immutable BigNumber-style wrapper pairing a `bigint` base-unit value with an
 * `AmountToken`. All arithmetic methods return new `BigAmount` instances.
 *
 * @example
 * const usdc = { decimals: 6 };
 * const a = BigAmount.from(1_000_000n, usdc);   // 1.000000 USDC
 * const b = BigAmount.parse("0.5", usdc);        // 0.500000 USDC
 * a.add(b).format({ trimZeros: true })            // "1.5"
 * a.applyBasisPoints(300).toRaw()                 // 30_000n (3%)
 */
export class BigAmount {
  private constructor(private readonly _raw: bigint, readonly token: AmountToken) {
    normalizeDecimals(token);
  }

  static from(value: bigint, token: AmountToken): BigAmount {
    return new BigAmount(value, token);
  }

  static parse(display: string, token: AmountToken): BigAmount {
    return new BigAmount(parseAmount(display, token), token);
  }

  // ── Arithmetic ──────────────────────────────────────────────────────────────

  add(other: BigAmount): BigAmount {
    assertSameDecimals(this.token, other.token, 'add');
    return new BigAmount(this._raw + other._raw, this.token);
  }

  subtract(other: BigAmount): BigAmount {
    assertSameDecimals(this.token, other.token, 'subtract');
    return new BigAmount(this._raw - other._raw, this.token);
  }

  /** Scale by an integer factor. */
  multiply(factor: bigint): BigAmount {
    return new BigAmount(this._raw * factor, this.token);
  }

  /**
   * Apply a basis-point rate: `value * bps / 10_000`.
   * Remainder is truncated (floor division).
   */
  applyBasisPoints(bps: number): BigAmount {
    return new BigAmount(applyBasisPoints(this._raw, bps, this.token), this.token);
  }

  // ── Comparison ──────────────────────────────────────────────────────────────

  compare(other: BigAmount): -1 | 0 | 1 {
    assertSameDecimals(this.token, other.token, 'compare');
    if (this._raw < other._raw) return -1;
    if (this._raw > other._raw) return 1;
    return 0;
  }

  isZero(): boolean {
    return this._raw === 0n;
  }

  isNegative(): boolean {
    return this._raw < 0n;
  }

  // ── Conversion ──────────────────────────────────────────────────────────────

  toRaw(): bigint {
    return this._raw;
  }

  /** Format using `formatAmount` by default; accepts `FormatOptions` for richer output. */
  format(opts?: FormatOptions): string {
    if (this._raw < 0n) {
      throw new Error('Cannot format a negative BigAmount.');
    }
    if (!opts || Object.keys(opts).length === 0) {
      return formatAmount(this._raw, this.token);
    }
    return formatAmountOptions(this._raw, this.token, opts);
  }

  toString(): string {
    return this.format();
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function normalizeDecimals(token: AmountToken): number {
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > MAX_DECIMALS) {
    throw new Error(`Token decimals must be an integer between 0 and ${MAX_DECIMALS}.`);
  }
  return token.decimals;
}

function assertSameDecimals(a: AmountToken, b: AmountToken, op: string): void {
  if (a.decimals !== b.decimals) {
    throw new Error(
      `Cannot ${op} amounts with different token decimals (${a.decimals} vs ${b.decimals}).`
    );
  }
}

function formatCompact(amount: bigint, decimals: number, scale: bigint): string {
  const MILLION = 1_000_000n;
  const THOUSAND = 1_000n;

  // Work in display units (divide by token scale) then apply K/M
  const displayScale = scale;
  const whole = amount / displayScale;

  if (whole >= MILLION) {
    const mWhole = whole / MILLION;
    const mFrac = ((whole % MILLION) * 10n) / MILLION;
    return mFrac > 0n ? `${mWhole}.${mFrac}M` : `${mWhole}M`;
  }
  if (whole >= THOUSAND) {
    const kWhole = whole / THOUSAND;
    const kFrac = ((whole % THOUSAND) * 10n) / THOUSAND;
    return kFrac > 0n ? `${kWhole}.${kFrac}K` : `${kWhole}K`;
  }

  // Below 1K: show whole units with trimmed fraction
  const fraction = (amount % displayScale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

export interface FormatAmountOptions {
  locale?: string;
  currency?: string;
  decimals?: number;
  compact?: boolean;
  minPrecision?: number;
  maxPrecision?: number;
}

export const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 7,
  XLM: 7,
  ILN: 7,
  BTC: 7,
  ETH: 7,
};

export const TOKEN_SYMBOLS: Record<string, string> = {
  USDC: '$',
  XLM: 'XLM',
  ILN: 'ILN',
  BTC: '₿',
  ETH: 'Ξ',
};

/**
 * Format a token amount correctly based on its native decimals and desired locale.
 * @param amount - The raw amount in stroops/smallest unit (as bigint or string).
 * @param token - The token symbol (e.g. "USDC", "XLM").
 * @param options - Custom formatting options.
 */
export function formatTokenAmount(
  amount: bigint | string | number,
  token: string,
  options?: FormatAmountOptions
): string {
  const tokenDecimals = TOKEN_DECIMALS[token] ?? options?.decimals ?? 7;
  const divisor = BigInt(10 ** tokenDecimals);
  const rawAmount = BigInt(amount);

  const wholePart = rawAmount / divisor;
  const fractionalPart = rawAmount % divisor;

  // Convert to a JS number for Intl.NumberFormat
  // Note: For very large numbers, this might lose precision, but it's required for Intl.NumberFormat
  const numericAmount = Number(wholePart) + Number(fractionalPart) / Number(divisor);

  const formatOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits: options?.minPrecision ?? 0,
    maximumFractionDigits: options?.maxPrecision ?? tokenDecimals,
  };

  if (options?.compact) {
    formatOptions.notation = 'compact';
    formatOptions.compactDisplay = 'short';
  }

  if (options?.currency) {
    formatOptions.style = 'currency';
    formatOptions.currency = options.currency;
  }

  const locale = options?.locale ?? 'en-US';
  const formatter = new Intl.NumberFormat(locale, formatOptions);

  let formatted = formatter.format(numericAmount);

  // If no native currency symbol was requested via Intl, prepend/append manually based on known tokens
  if (!options?.currency) {
    const symbol = TOKEN_SYMBOLS[token] ?? token;
    // Basic heuristic: append symbol if it's alphanumeric, prepend if it's a character like $
    if (symbol.length === 1 && !/[A-Za-z0-9]/.test(symbol)) {
      formatted = `${symbol}${formatted}`;
    } else {
      formatted = `${formatted} ${symbol}`;
    }
  }

  return formatted;
}

import React from 'react';

export interface AmountDisplayProps {
  /** Raw amount in stroops (1 XLM = 10_000_000 stroops). */
  amount: bigint | number;
  /** Token symbol shown after the value (default "XLM"). */
  symbol?: string;
  /** Decimal places (default 7 for Stellar native). */
  decimals?: number;
  /** Locale string for number formatting (default "en-US"). */
  locale?: string;
  className?: string;
}

export const AmountDisplay: React.FC<AmountDisplayProps> = ({
  amount,
  symbol = 'XLM',
  decimals = 7,
  locale = 'en-US',
  className,
}) => {
  const divisor = 10 ** decimals;
  const value = Number(amount) / divisor;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(value);

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {formatted}
      {symbol && (
        <span style={{ marginLeft: 4, fontSize: '0.85em', color: '#6B7280', fontWeight: 500 }}>
          {symbol}
        </span>
      )}
    </span>
  );
};

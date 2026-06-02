export interface AmountToken {
  decimals: number;
}

const MAX_DECIMALS = 18;

export function parseAmount(input: string, token: AmountToken): bigint {
  const decimals = normalizeDecimals(token);
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) {
    throw new Error("Invalid amount. Use a non-negative decimal value.");
  }

  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`Invalid amount. Token supports at most ${decimals} decimal places.`);
  }

  const whole = BigInt(match[1]);
  const fractional = BigInt(fraction.padEnd(decimals, "0") || "0");
  return whole * 10n ** BigInt(decimals) + fractional;
}

export function formatAmount(amount: bigint, token: AmountToken): string {
  if (amount < 0n) {
    throw new Error("Cannot format a negative amount.");
  }

  const decimals = normalizeDecimals(token);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;

  if (decimals === 0) {
    return whole.toString();
  }

  const fraction = (amount % scale).toString().padStart(decimals, "0");
  return `${whole.toString()}.${fraction}`;
}

function normalizeDecimals(token: AmountToken): number {
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > MAX_DECIMALS) {
    throw new Error(`Token decimals must be an integer between 0 and ${MAX_DECIMALS}.`);
  }

  return token.decimals;
}

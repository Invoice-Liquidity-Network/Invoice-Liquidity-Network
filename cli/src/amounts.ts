const STROOPS_PER_UNIT = 10_000_000n;

export function parseDisplayAmount(input: string): bigint {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d{1,7}))?$/);
  if (!match) {
    throw new Error(
      'Invalid amount. Use a positive decimal value with up to 7 fractional digits, for example `100` or `12.5`.'
    );
  }

  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? '').padEnd(7, '0');
  return whole * STROOPS_PER_UNIT + BigInt(fraction || '0');
}

export function formatAmount(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? stroops * -1n : stroops;
  const whole = absolute / STROOPS_PER_UNIT;
  const fraction = (absolute % STROOPS_PER_UNIT).toString().padStart(7, '0').replace(/0+$/, '');
  const rendered = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${rendered}` : rendered;
}

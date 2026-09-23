export function parseDueDate(input: string): number {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const isoValue = isoDateOnly ? `${trimmed}T23:59:59Z` : trimmed;
  const timestamp = Date.parse(isoValue);

  if (Number.isNaN(timestamp)) {
    throw new Error('Invalid due date. Use a Unix timestamp or an ISO date like `2025-12-31`.');
  }

  return Math.floor(timestamp / 1000);
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Enumeration of all possible invoice states in the ILN protocol.
 *
 * This is an SDK-specific enum with utility helpers (`isPending`, `isTerminal`,
 * etc.) and display colors. It intentionally differs from @iln/shared's
 * InvoiceStatus (a string literal union) — prefer this enum for SDK consumers
 * that need runtime enum values and helper functions.
 *
 * NOTE: Keep the member set aligned with @iln/shared's InvoiceStatus.
 */
export enum InvoiceStatus {
  Pending = "Pending",
  Funded = "Funded",
  Paid = "Paid",
  Defaulted = "Defaulted",
  Disputed = "Disputed",
}

/**
 * Check if an invoice status string represents the Pending state.
 * @param status - The status string to check.
 * @returns `true` if the status is "Pending".
 */
export function isPending(status: string): boolean {
  return status === InvoiceStatus.Pending;
}

/**
 * Check if an invoice status string represents the Funded state.
 * @param status - The status string to check.
 * @returns `true` if the status is "Funded".
 */
export function isFunded(status: string): boolean {
  return status === InvoiceStatus.Funded;
}

/**
 * Check if an invoice status string represents the Paid state.
 * @param status - The status string to check.
 * @returns `true` if the status is "Paid".
 */
export function isPaid(status: string): boolean {
  return status === InvoiceStatus.Paid;
}

/**
 * Check if an invoice status string represents the Defaulted state.
 * @param status - The status string to check.
 * @returns `true` if the status is "Defaulted".
 */
export function isDefaulted(status: string): boolean {
  return status === InvoiceStatus.Defaulted;
}

/**
 * Check if an invoice status string represents the Disputed state.
 * @param status - The status string to check.
 * @returns `true` if the status is "Disputed".
 */
export function isDisputed(status: string): boolean {
  return status === InvoiceStatus.Disputed;
}

/**
 * Check if an invoice status is terminal (Paid, Defaulted, or Disputed).
 * Terminal states represent completed invoice lifecycles.
 *
 * @param status - The status string to check.
 * @returns `true` if the status is terminal.
 */
export function isTerminal(status: string): boolean {
  return isPaid(status) || isDefaulted(status) || isDisputed(status);
}

/**
 * Map of invoice statuses to their display colors (hex).
 * Useful for UI rendering of invoice status badges.
 */
export const InvoiceStatusColor: Record<string, string> = {
  [InvoiceStatus.Pending]: "#F59E0B",
  [InvoiceStatus.Funded]: "#3B82F6",
  [InvoiceStatus.Paid]: "#10B981",
  [InvoiceStatus.Defaulted]: "#EF4444",
  [InvoiceStatus.Disputed]: "#8B5CF6",
};

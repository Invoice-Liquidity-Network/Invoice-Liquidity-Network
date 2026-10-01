import { expect } from 'vitest';
import type { Invoice, InvoiceState, GovernanceProposal } from '@iln/sdk';

/** Assert that an invoice has all required fields with correct types. */
export function assertValidInvoice(invoice: unknown): asserts invoice is Invoice {
  expect(invoice).toBeTruthy();
  const inv = invoice as Record<string, unknown>;
  expect(typeof inv.id === 'bigint' || typeof inv.id === 'number').toBe(true);
  expect(typeof inv.freelancer).toBe('string');
  expect(typeof inv.payer).toBe('string');
  expect(typeof inv.amount === 'bigint' || typeof inv.amount === 'number').toBe(true);
  expect(typeof inv.dueDate).toBe('number');
  expect(typeof inv.discountRate).toBe('number');
  expect(['Pending', 'Funded', 'Paid', 'Defaulted']).toContain(inv.status);
}

/** Assert that an invoice has a specific status. */
export function assertInvoiceStatus(invoice: Invoice, status: InvoiceState): void {
  expect((invoice as any).status).toBe(status);
}

/** Assert that an invoice amount matches within a tolerance (handles BigInt). */
export function assertAmountClose(
  actual: bigint | number,
  expected: bigint | number,
  toleranceBps = 1n
): void {
  const a = typeof actual === 'bigint' ? actual : BigInt(Math.round(actual));
  const e = typeof expected === 'bigint' ? expected : BigInt(Math.round(expected));
  const diff = a > e ? a - e : e - a;
  expect(diff).toBeLessThanOrEqual(toleranceBps);
}

/** Assert that a governance proposal is in an active/voteable state. */
export function assertProposalActive(proposal: GovernanceProposal): void {
  expect(proposal).toBeTruthy();
  expect(typeof proposal.id === 'bigint' || typeof proposal.id === 'number').toBe(true);
  expect(proposal.votingEnd).toBeGreaterThan(0);
}

/** Assert that an async function rejects with an error whose message matches the pattern. */
export async function assertRejects(
  fn: () => Promise<unknown>,
  pattern?: string | RegExp
): Promise<void> {
  let threw = false;
  let err: Error | undefined;
  try {
    await fn();
  } catch (e: any) {
    threw = true;
    err = e;
  }
  expect(threw).toBe(true);
  if (pattern) {
    if (typeof pattern === 'string') {
      expect(err?.message ?? '').toContain(pattern);
    } else {
      expect(err?.message ?? '').toMatch(pattern);
    }
  }
}

/** Assert that an array of invoices is sorted by amount descending. */
export function assertSortedByAmountDesc(invoices: Invoice[]): void {
  for (let i = 1; i < invoices.length; i++) {
    const prev = BigInt((invoices[i - 1] as any).amount ?? 0);
    const curr = BigInt((invoices[i] as any).amount ?? 0);
    expect(prev >= curr).toBe(true);
  }
}

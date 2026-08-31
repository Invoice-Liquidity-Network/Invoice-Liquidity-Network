import { expect } from 'vitest';
import type { Invoice } from './dataGenerators';

export function expectValidInvoice(inv: Invoice) {
  expect(inv).toBeTruthy();
  expect(typeof inv.id).toBe('string');
  expect(inv.amount).toBeGreaterThan(0);
  expect(typeof inv.currency).toBe('string');
  expect(new Date(inv.dueDate).toString()).not.toBe('Invalid Date');
  expect(inv.supplier?.id).toBeTruthy();
  expect(inv.buyer?.id).toBeTruthy();
}

export function expectNetworkCalledWith(urlPart: string, calls: Array<{ url: string }>) {
  const found = calls.some((c) => c.url.includes(urlPart));
  expect(found).toBeTruthy();
}

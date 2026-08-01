import { randomUUID } from 'crypto';

export function buildInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const id = overrides.id ?? `inv_${randomUUID()}`;
  const amount = overrides.amount ?? Math.floor(Math.random() * 100000) + 100;
  const dueDate = overrides.dueDate ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  return {
    id,
    amount,
    currency: overrides.currency ?? 'USD',
    dueDate,
    supplier: overrides.supplier ?? { id: `supp_${randomUUID()}`, name: 'Supplier Inc' },
    buyer: overrides.buyer ?? { id: `buyer_${randomUUID()}`, name: 'Buyer LLC' },
    metadata: overrides.metadata ?? {},
  };
}

export type Party = { id: string; name: string };

export type Invoice = {
  id: string;
  amount: number;
  currency: string;
  dueDate: string;
  supplier: Party;
  buyer: Party;
  metadata?: Record<string, unknown>;
};

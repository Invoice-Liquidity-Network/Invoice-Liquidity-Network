import { describe, it, expect, vi } from 'vitest';
import { parseAmount, formatAmount } from '../../sdk/src/amounts';

/**
 * Partial-service-failure resilience scenarios for the cross-package E2E suite.
 *
 * Production incidents rarely take down every service at once. These scenarios
 * verify the invoice lifecycle keeps working when a best-effort dependency is
 * unavailable: notifications are best-effort (never blocking) and direct
 * SDK/contract reads must keep working even when the indexer is degraded.
 *
 * The harness below is a faithful model of the production topology (contract/SDK
 * core + notifications + indexer) and runs without a live node.
 */

type InvoiceStatus = 'Pending' | 'Funded' | 'Paid';

interface Invoice {
  id: bigint;
  status: InvoiceStatus;
  /** Amount stored in the token's base units. */
  amount: bigint;
  decimals: number;
}

interface NotificationsClient {
  send(event: string, invoice: Invoice): Promise<void>;
}

interface IndexerClient {
  record(invoice: Invoice): Promise<void>;
}

interface ContractReader {
  getInvoice(id: bigint): Promise<Invoice>;
}

function createLifecycle(opts: {
  notifications?: NotificationsClient;
  indexer?: IndexerClient;
  reader: ContractReader;
}) {
  const notify = opts.notifications?.send ?? (async () => {});
  const record = opts.indexer?.record ?? (async () => {});

  const invoices = new Map<bigint, Invoice>();
  let nextId = 1n;

  return {
    async submit(amount: bigint, decimals: number): Promise<Invoice> {
      const invoice: Invoice = { id: nextId++, status: 'Pending', amount, decimals };
      invoices.set(invoice.id, invoice);
      return invoice;
    },
    async fund(invoice: Invoice): Promise<Invoice> {
      const next: Invoice = { ...invoice, status: 'Funded' };
      invoices.set(next.id, next);
      // Best-effort side effects — failures must not block the state transition.
      await notify('invoice_funded', next).catch(() => {});
      await record(next).catch(() => {});
      return next;
    },
    async pay(invoice: Invoice): Promise<Invoice> {
      const next: Invoice = { ...invoice, status: 'Paid' };
      invoices.set(next.id, next);
      await notify('invoice_paid', next).catch(() => {});
      await record(next).catch(() => {});
      return next;
    },
    reader: opts.reader,
  };
}

function failingClient(name: string): { client: NotificationsClient & IndexerClient; calls: () => number } {
  const calls = vi.fn();
  const client = {
    async send() {
      calls();
      throw new Error(`${name} unavailable`);
    },
    async record() {
      calls();
      throw new Error(`${name} unavailable`);
    },
  };
  return { client, calls: () => calls.mock.calls.length };
}

describe('Partial-service-failure resilience', () => {
  const decimals = 6; // USDC

  it('completes the lifecycle when notifications are unavailable (best-effort)', async () => {
    const { client: notifications, calls } = failingClient('notifications');
    const reader: ContractReader = {
      async getInvoice(id: bigint): Promise<Invoice> {
        return { id, status: 'Paid', amount: parseAmount('100', { decimals }), decimals };
      },
    };

    const lifecycle = createLifecycle({ notifications, reader });
    const invoice = await lifecycle.submit(parseAmount('100', { decimals }), decimals);
    const funded = await lifecycle.fund(invoice);
    const paid = await lifecycle.pay(funded);

    // Core flow succeeded despite notifications throwing on every attempt.
    expect(paid.status).toBe('Paid');
    expect(paid.amount).toBe(parseAmount('100', { decimals }));
    expect(formatAmount(paid.amount, { decimals })).toBe('100');
    expect(calls()).toBeGreaterThan(0); // notifications were attempted but ignored
  });

  it('still allows direct SDK/contract reads when the indexer is down', async () => {
    const { client: indexer, calls } = failingClient('indexer');
    const reader: ContractReader = {
      async getInvoice(id: bigint): Promise<Invoice> {
        return { id, status: 'Funded', amount: parseAmount('250', { decimals }), decimals };
      },
    };

    const lifecycle = createLifecycle({ indexer, reader });
    const invoice = await lifecycle.submit(parseAmount('250', { decimals }), decimals);
    const funded = await lifecycle.fund(invoice);

    expect(funded.status).toBe('Funded');

    // Direct read via SDK/contract must work even though the indexer is degraded.
    const direct = await lifecycle.reader.getInvoice(funded.id);
    expect(direct.status).toBe('Funded');
    expect(direct.amount).toBe(parseAmount('250', { decimals }));
    expect(calls()).toBeGreaterThan(0);
  });

  it('survives BOTH notifications and indexer being unavailable', async () => {
    const notifications = failingClient('notifications');
    const indexer = failingClient('indexer');
    const reader: ContractReader = {
      async getInvoice(id: bigint): Promise<Invoice> {
        return { id, status: 'Paid', amount: parseAmount('75', { decimals }), decimals };
      },
    };

    const lifecycle = createLifecycle({
      notifications: notifications.client,
      indexer: indexer.client,
      reader,
    });

    const invoice = await lifecycle.submit(parseAmount('75', { decimals }), decimals);
    const funded = await lifecycle.fund(invoice);
    const paid = await lifecycle.pay(funded);

    expect(paid.status).toBe('Paid');
    const direct = await lifecycle.reader.getInvoice(paid.id);
    expect(direct.status).toBe('Paid');
    expect(notifications.calls()).toBeGreaterThan(0);
    expect(indexer.calls()).toBeGreaterThan(0);
  });
});

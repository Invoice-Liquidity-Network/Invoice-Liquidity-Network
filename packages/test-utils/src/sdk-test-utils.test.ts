import { describe, it, expect, vi } from 'vitest';
import { createMockILNClient, MOCK_INVOICE, MOCK_LP_STATS, MOCK_CONTRACT_STATS } from './mocks';
import {
  assertValidInvoice,
  assertInvoiceStatus,
  assertAmountClose,
  assertRejects,
  assertSortedByAmountDesc,
} from './assertions';
import { createInvoice } from './factories';

describe('createMockILNClient', () => {
  it('returns a client with all expected methods', () => {
    const client = createMockILNClient();
    expect(typeof client.getInvoice).toBe('function');
    expect(typeof client.submitInvoice).toBe('function');
    expect(typeof client.fundInvoice).toBe('function');
    expect(typeof client.markPaid).toBe('function');
    expect(typeof client.connectWallet).toBe('function');
  });

  it('getInvoice resolves to an invoice-like object', async () => {
    const client = createMockILNClient();
    const invoice = await (client.getInvoice as any)(1);
    expect(invoice).toBeTruthy();
  });

  it('respects overrides', async () => {
    const client = createMockILNClient({
      connectWallet: vi.fn().mockResolvedValue('GOVERRIDE'),
    });
    const addr = await client.connectWallet();
    expect(addr).toBe('GOVERRIDE');
  });
});

describe('MOCK_* constants', () => {
  it('MOCK_INVOICE has expected fields', () => {
    expect(MOCK_INVOICE.status).toBe('Pending');
    expect(typeof MOCK_INVOICE.discountRate).toBe('number');
  });

  it('MOCK_LP_STATS has address and invoiceCount', () => {
    expect(MOCK_LP_STATS.invoiceCount).toBe(10);
    expect(typeof MOCK_LP_STATS.address).toBe('string');
  });

  it('MOCK_CONTRACT_STATS has totalInvoices', () => {
    expect(MOCK_CONTRACT_STATS.totalInvoices).toBe(500);
    expect(MOCK_CONTRACT_STATS.defaultRate).toBe(0.02);
  });
});

describe('assertValidInvoice', () => {
  it('passes for a valid factory invoice', () => {
    const invoice = createInvoice();
    expect(() => assertValidInvoice(invoice)).not.toThrow();
  });

  it('fails for a missing field', () => {
    expect(() => assertValidInvoice({ id: 1n, freelancer: 'G...' })).toThrow();
  });
});

describe('assertInvoiceStatus', () => {
  it('passes when status matches', () => {
    const inv = createInvoice({ status: 'Funded' });
    expect(() => assertInvoiceStatus(inv as any, 'Funded')).not.toThrow();
  });

  it('fails when status differs', () => {
    const inv = createInvoice({ status: 'Pending' });
    expect(() => assertInvoiceStatus(inv as any, 'Funded')).toThrow();
  });
});

describe('assertAmountClose', () => {
  it('passes when values are equal', () => {
    expect(() => assertAmountClose(100n, 100n)).not.toThrow();
  });

  it('fails when difference exceeds tolerance', () => {
    expect(() => assertAmountClose(100n, 200n, 1n)).toThrow();
  });
});

describe('assertRejects', () => {
  it('passes when function rejects', async () => {
    await assertRejects(() => Promise.reject(new Error('boom')));
  });

  it('passes with matching message pattern', async () => {
    await assertRejects(() => Promise.reject(new Error('boom')), 'boom');
  });

  it('fails when function does not reject', async () => {
    await expect(assertRejects(() => Promise.resolve())).rejects.toThrow();
  });
});

describe('assertSortedByAmountDesc', () => {
  it('passes for correctly sorted invoices', () => {
    const invs = [300, 200, 100].map((a) => createInvoice({ amount: BigInt(a) }));
    expect(() => assertSortedByAmountDesc(invs as any)).not.toThrow();
  });

  it('fails for incorrectly sorted invoices', () => {
    const invs = [100, 200, 300].map((a) => createInvoice({ amount: BigInt(a) }));
    expect(() => assertSortedByAmountDesc(invs as any)).toThrow();
  });
});

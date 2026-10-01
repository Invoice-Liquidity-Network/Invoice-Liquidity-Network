import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, nativeToScVal } from '@stellar/stellar-sdk';

describe('ILNSdk debug logging', () => {
  const originalEnv = process.env.ILN_DEBUG;
  const originalConsoleLog = console.log;

  beforeEach(() => {
    vi.resetModules();
    process.env.ILN_DEBUG = '1';
    // The logger routes DEBUG-level entries through console.log (see logger.ts).
    globalThis.console.log = vi.fn();
  });

  afterEach(() => {
    process.env.ILN_DEBUG = originalEnv;
    globalThis.console.log = originalConsoleLog;
  });

  it('emits debug logs when ILN_DEBUG=1', async () => {
    const { ILNSdk } = await import('./client');
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal({
            amount: 25000000n,
            amount_funded: 25000000n,
            amount_paid: 0n,
            discount_rate: 300,
            due_date: 1700000000,
            funder: Keypair.random().publicKey(),
            funded_at: 1699999000,
            freelancer: Keypair.random().publicKey(),
            id: 7n,
            payer: Keypair.random().publicKey(),
            status: 'Funded',
            submitter_reputation: 0,
            token: Keypair.random().publicKey(),
          }),
        },
      }),
    };

    const sdk = new ILNSdk({
      contractId: 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC',
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'https://example.test',
      server,
    });

    await sdk.getInvoice(7n);

    expect(console.log).toHaveBeenCalled();
  });
});

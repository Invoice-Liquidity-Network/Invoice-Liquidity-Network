import { describe, it, expect, vi } from 'vitest';
import { RequestBatcher } from './batcher';
import { ILNSdk } from './client';
import type { RpcServerLike } from './types';

describe('RequestBatcher', () => {
  it('is disabled by default when no batching option is provided', () => {
    const batcher = new RequestBatcher();
    expect(batcher.isEnabled).toBe(false);
  });

  it('can be enabled via boolean or options object', () => {
    const batcher1 = new RequestBatcher(true);
    expect(batcher1.isEnabled).toBe(true);

    const batcher2 = new RequestBatcher({ enabled: true, windowMs: 15 });
    expect(batcher2.isEnabled).toBe(true);
  });

  it('deduplicates in-flight identical read requests when enabled', async () => {
    const batcher = new RequestBatcher({ enabled: true, windowMs: 10, deduplicate: true });
    const spyFetcher = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r('result'), 20)));

    const [res1, res2, res3] = await Promise.all([
      batcher.execute('invoice:42', spyFetcher),
      batcher.execute('invoice:42', spyFetcher),
      batcher.execute('invoice:42', spyFetcher),
    ]);

    expect(res1).toBe('result');
    expect(res2).toBe('result');
    expect(res3).toBe('result');
    expect(spyFetcher).toHaveBeenCalledTimes(1);

    const metrics = batcher.getMetrics();
    expect(metrics.totalRequests).toBe(3);
    expect(metrics.deduplicatedRequests).toBe(2);
    expect(metrics.rpcCallsSaved).toBe(2);
    expect(metrics.reductionPercentage).toBe(66.67);
  });

  it('handles distinct read keys independently', async () => {
    const batcher = new RequestBatcher({ enabled: true, windowMs: 10 });
    const fetcherA = vi.fn().mockResolvedValue('invoice-1');
    const fetcherB = vi.fn().mockResolvedValue('invoice-2');

    const [resA, resB] = await Promise.all([
      batcher.execute('invoice:1', fetcherA),
      batcher.execute('invoice:2', fetcherB),
    ]);

    expect(resA).toBe('invoice-1');
    expect(resB).toBe('invoice-2');
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });

  it('integrates with ILNSdk client when config.batching is opt-in', async () => {
    const mockServer: RpcServerLike = {
      getAccount: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: {
            switch: () => 'scvMap',
            map: () => [],
          },
        },
      }),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
    };

    const sdk = new ILNSdk({
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      server: mockServer,
      verifyContractId: false,
      batching: { enabled: true, windowMs: 10 },
    });

    // Issue 5 simultaneous getInvoice calls for same ID
    const promises = Array.from({ length: 5 }, () =>
      sdk.getInvoice(42n, { bypass: true }).catch(() => null)
    );

    await Promise.all(promises);

    const metrics = sdk.getBatchingMetrics();
    expect(metrics.totalRequests).toBe(5);
    expect(metrics.deduplicatedRequests).toBe(4);
    expect(metrics.rpcCallsSaved).toBe(4);
  });
});

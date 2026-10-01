import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, nativeToScVal } from '@stellar/stellar-sdk';

import { ILNSdk } from './client';
import { RpcCircuitOpenError } from './errors';
import { getRpcResilience } from './rpc-resilience';
import type { RpcServerLike } from './types';

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const CONTRACT_ID = 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC';

function invoiceRetval() {
  return {
    result: {
      retval: nativeToScVal({
        amount: 25000000n,
        amount_funded: 0n,
        amount_paid: 0n,
        discount_rate: 300,
        due_date: 1700000000,
        funder: null,
        funded_at: null,
        freelancer: Keypair.random().publicKey(),
        id: 7n,
        payer: Keypair.random().publicKey(),
        status: 'Pending',
        submitter_reputation: 0,
        token: 'CTOKEN0000000000000000000000000000000000000000000000000',
        referral_code: null,
        allowed_lps: null,
        is_auction: false,
        auction_start_rate: null,
        auction_min_rate: null,
        auction_rate_decay_per_hour: null,
        auction_started_at: null,
      }),
    },
  };
}

const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

describe('ILNSdk RPC resilience wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a read that failed transiently by issuing a new RPC request (regression: retries used to re-await the same promise)', async () => {
    const simulateTransaction = vi
      .fn()
      .mockRejectedValueOnce(reset())
      .mockResolvedValueOnce(invoiceRetval());
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction,
    } satisfies RpcServerLike;
    const sdk = new ILNSdk({
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: 'https://example.test',
      server,
      backoff: { baseDelayMs: 5, jitter: 0 },
      cache: { enabled: false, ttl: 0, storage: 'memory' },
    });

    const pending = sdk.getInvoice(7n);
    await vi.advanceTimersByTimeAsync(5);
    const invoice = await pending;
    expect(invoice.id).toBe(7n);
    expect(simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it('honours `backoff: false` (single attempt) and `circuitBreaker: false`', async () => {
    const simulateTransaction = vi.fn().mockRejectedValue(reset());
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction,
    } satisfies RpcServerLike;
    const sdk = new ILNSdk({
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: 'https://example.test',
      server,
      backoff: false,
      circuitBreaker: false,
      cache: { enabled: false, ttl: 0, storage: 'memory' },
    });
    await expect(sdk.getInvoice(7n)).rejects.toBeDefined();
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
    expect(
      getRpcResilience(sdk as unknown as { server: object }['server'] & object)
    ).toBeUndefined();
  });

  it('fails fast with RpcCircuitOpenError once the endpoint is degraded', async () => {
    const simulateTransaction = vi.fn().mockRejectedValue(reset());
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction,
    } satisfies RpcServerLike;
    const sdk = new ILNSdk({
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: 'https://example.test',
      server,
      backoff: false,
      circuitBreaker: { minimumCalls: 3, failureRateThreshold: 0.5 },
      cache: { enabled: false, ttl: 0, storage: 'memory' },
    });
    for (let i = 0; i < 3; i += 1) await expect(sdk.getInvoice(BigInt(i))).rejects.toBeDefined();
    await expect(sdk.getInvoice(99n)).rejects.toBeInstanceOf(RpcCircuitOpenError);
    expect(simulateTransaction).toHaveBeenCalledTimes(3);
  });
});

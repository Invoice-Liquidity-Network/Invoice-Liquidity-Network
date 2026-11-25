/**
 * Tests for ILNClient's transaction confirmation reconciliation (#1493).
 *
 * `sendTransaction` returning PENDING/DUPLICATE only means the network
 * accepted the submission — it says nothing about whether the write
 * actually succeeded on-chain. These tests verify the client polls
 * `getTransaction` for a confirmed final status before reporting success,
 * and that a timed-out poll is reported as an unknown outcome rather than
 * a false claim of failure.
 */

import { describe, expect, it, vi } from 'vitest';
import { Account, Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

import { ILNClient } from '../src/client';
import type { RpcServerLike, TransactionSigner } from '../src/types';

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const CONTRACT_ID = 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC';

function createSignerFromKeypair(keypair: Keypair): TransactionSigner {
  return {
    async getPublicKey() {
      return keypair.publicKey();
    },
    async signTransaction(transactionXdr: string, networkPassphrase: string) {
      const transaction = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
      transaction.sign(keypair);
      return transaction.toXDR();
    },
  };
}

function createClient(server: RpcServerLike, signer: TransactionSigner) {
  return new ILNClient({
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: 'https://example.test',
    server,
    signer,
    pollIntervalMs: 0,
  });
}

describe('ILNClient transaction confirmation reconciliation', () => {
  it('only reports success once getTransaction confirms SUCCESS, not from the PENDING submission alone', async () => {
    const keypair = Keypair.random();
    const signer = createSignerFromKeypair(keypair);
    const getTransaction = vi
      .fn()
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'SUCCESS' });

    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(keypair.publicKey(), '1')),
      simulateTransaction: vi.fn().mockResolvedValue({}),
      prepareTransaction: vi.fn().mockImplementation(async (transaction) => transaction),
      sendTransaction: vi.fn().mockResolvedValue({ hash: 'a'.repeat(64), status: 'PENDING' }),
      getTransaction,
    } satisfies RpcServerLike;

    const client = createClient(server, signer);
    const result = await client.markPaid(1n);

    expect(result).toEqual({ hash: 'a'.repeat(64) });
    expect(getTransaction).toHaveBeenCalledTimes(3);
    expect(getTransaction).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('throws a terminal failure error — never a reported success — when the RPC confirms FAILED', async () => {
    const keypair = Keypair.random();
    const signer = createSignerFromKeypair(keypair);

    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(keypair.publicKey(), '1')),
      simulateTransaction: vi.fn().mockResolvedValue({}),
      prepareTransaction: vi.fn().mockImplementation(async (transaction) => transaction),
      sendTransaction: vi.fn().mockResolvedValue({ hash: 'b'.repeat(64), status: 'PENDING' }),
      getTransaction: vi.fn().mockResolvedValue({ status: 'FAILED' }),
    } satisfies RpcServerLike;

    const client = createClient(server, signer);

    await expect(client.markPaid(1n)).rejects.toThrow(/failed on-chain/);
  });

  it('reports an unknown outcome — not a false failure — when polling exhausts attempts while still NOT_FOUND', async () => {
    const keypair = Keypair.random();
    const signer = createSignerFromKeypair(keypair);

    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(keypair.publicKey(), '1')),
      simulateTransaction: vi.fn().mockResolvedValue({}),
      prepareTransaction: vi.fn().mockImplementation(async (transaction) => transaction),
      sendTransaction: vi.fn().mockResolvedValue({ hash: 'c'.repeat(64), status: 'PENDING' }),
      getTransaction: vi.fn().mockResolvedValue({ status: 'NOT_FOUND' }),
    } satisfies RpcServerLike;

    const client = createClient(server, signer);

    await expect(client.markPaid(1n)).rejects.toThrow(/unknown outcome/i);
  });
});

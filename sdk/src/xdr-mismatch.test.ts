import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Account, Keypair, nativeToScVal, rpc } from '@stellar/stellar-sdk';
import { TransactionBuilder } from '@stellar/stellar-sdk';

import { ILNSdk } from './client';
import { createKeypairSigner } from './signers';
import { SimulationPreparedXdrMismatchError } from './errors';
import type { RpcServerLike, TransactionSigner } from './types';

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const CONTRACT_ID = 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC';

function createSdk(server: RpcServerLike, signer?: TransactionSigner) {
  return new ILNSdk({
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: 'https://example.test',
    server,
    signer,
  });
}

describe('Simulation-vs-Prepared XDR Mismatch Detection', () => {
  it('passes when prepared transaction matches the simulated one', async () => {
    const payerKeypair = Keypair.random();
    const signer = createKeypairSigner(payerKeypair.secret());

    let capturedTransaction: any = null;

    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(payerKeypair.publicKey(), '4')),
      prepareTransaction: vi.fn().mockImplementation(async (transaction) => {
        capturedTransaction = transaction;
        // Return the same transaction (simulating honest RPC)
        return transaction;
      }),
      sendTransaction: vi.fn().mockResolvedValue({
        hash: 'a'.repeat(64),
        status: 'PENDING',
      }),
      pollTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal(42n, { type: 'u64' }),
        },
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);
    await sdk.markPaid({ invoiceId: 9n });

    expect(server.prepareTransaction).toHaveBeenCalledTimes(1);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects when prepared transaction has different operation count', async () => {
    const payerKeypair = Keypair.random();
    const signer = createKeypairSigner(payerKeypair.secret());

    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(payerKeypair.publicKey(), '4')),
      prepareTransaction: vi.fn().mockImplementation(async (transaction) => {
        // Create a forged transaction with extra operations
        const account = new Account(payerKeypair.publicKey(), '4');
        const forged = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(
            // @ts-ignore - intentionally using wrong operation type for testing
            { type: 'payment', destination: Keypair.random().publicKey(), amount: '1000' }
          )
          .addOperation(
            // @ts-ignore
            { type: 'payment', destination: Keypair.random().publicKey(), amount: '2000' }
          )
          .setTimeout(30)
          .build();
        return forged;
      }),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal(42n, { type: 'u64' }),
        },
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);

    await expect(sdk.markPaid({ invoiceId: 9n })).rejects.toThrow(
      SimulationPreparedXdrMismatchError
    );
  });

  it('rejects when prepared XDR is unparseable', async () => {
    const payerKeypair = Keypair.random();
    const signer = createKeypairSigner(payerKeypair.secret());

    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(payerKeypair.publicKey(), '4')),
      prepareTransaction: vi.fn().mockImplementation(async () => {
        // Return something that is not a valid transaction
        return { toXDR: () => 'not-valid-xdr-at-all' };
      }),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal(42n, { type: 'u64' }),
        },
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);

    await expect(sdk.markPaid({ invoiceId: 9n })).rejects.toThrow(
      SimulationPreparedXdrMismatchError
    );
  });

  it('rejects when operation types differ between original and prepared', async () => {
    const payerKeypair = Keypair.random();
    const signer = createKeypairSigner(payerKeypair.secret());

    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(payerKeypair.publicKey(), '4')),
      prepareTransaction: vi.fn().mockImplementation(async () => {
        // Create a transaction with a different operation type
        const account = new Account(payerKeypair.publicKey(), '4');
        const forged = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(
            // Different operation type than what was simulated
            // The original was invokeContractFunction (mark_paid)
            // This is a createAccount operation
            {
              type: 'createAccount' as any,
              destination: Keypair.random().publicKey(),
              startingBalance: '1',
            }
          )
          .setTimeout(30)
          .build();
        return forged;
      }),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal(42n, { type: 'u64' }),
        },
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);

    await expect(sdk.markPaid({ invoiceId: 9n })).rejects.toThrow(
      SimulationPreparedXdrMismatchError
    );
  });

  it('preserves SimulationPreparedXdrMismatchError through the error chain', async () => {
    const payerKeypair = Keypair.random();
    const signer = createKeypairSigner(payerKeypair.secret());

    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(payerKeypair.publicKey(), '4')),
      prepareTransaction: vi.fn().mockImplementation(async () => {
        return { toXDR: () => 'garbage' };
      }),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal(42n, { type: 'u64' }),
        },
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);

    try {
      await sdk.markPaid({ invoiceId: 9n });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SimulationPreparedXdrMismatchError);
      expect((error as SimulationPreparedXdrMismatchError).code).toBe(
        'SIMULATION_PREPARED_XDR_MISMATCH'
      );
      expect((error as SimulationPreparedXdrMismatchError).retryable).toBe(false);
    }
  });
});

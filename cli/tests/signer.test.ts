import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createKeypairFileSigner } from '../src/signer';

/**
 * Signer selection and key isolation (#1491): a signer bound to one network
 * profile must not sign another network's transaction, and must not sign a
 * transaction whose source is a different account.
 */

const keypair = Keypair.random();

function keyFile(content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'iln-signer-'));
  const file = path.join(dir, 'key.secret');
  writeFileSync(file, content);
  return file;
}

function buildTx(source: string, passphrase: string): string {
  return new TransactionBuilder(new Account(source, '1'), {
    fee: '100',
    networkPassphrase: passphrase,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
    .setTimeout(30)
    .build()
    .toXDR();
}

describe('createKeypairFileSigner', () => {
  it('signs its own transaction on the bound network', async () => {
    const signer = createKeypairFileSigner(keyFile(keypair.secret()), {
      networkPassphrase: Networks.TESTNET,
    });

    const signed = await signer.signTransaction(
      buildTx(keypair.publicKey(), Networks.TESTNET),
      Networks.TESTNET
    );

    const tx = TransactionBuilder.fromXDR(signed, Networks.TESTNET);
    expect(tx.signatures).toHaveLength(1);
    expect(keypair.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
  });

  it('reads a JSON key file', async () => {
    const signer = createKeypairFileSigner(
      keyFile(JSON.stringify({ secretKey: keypair.secret() }))
    );

    expect(await signer.getPublicKey()).toBe(keypair.publicKey());
  });

  it('refuses to sign for a network other than the bound profile', async () => {
    const signer = createKeypairFileSigner(keyFile(keypair.secret()), {
      networkPassphrase: Networks.TESTNET,
    });

    await expect(
      signer.signTransaction(buildTx(keypair.publicKey(), Networks.PUBLIC), Networks.PUBLIC)
    ).rejects.toThrow(/does not match the active profile network/);
  });

  it('refuses to sign a transaction whose source is another account', async () => {
    const signer = createKeypairFileSigner(keyFile(keypair.secret()), {
      networkPassphrase: Networks.TESTNET,
    });
    const other = Keypair.random().publicKey();

    await expect(
      signer.signTransaction(buildTx(other, Networks.TESTNET), Networks.TESTNET)
    ).rejects.toThrow(/is not the configured signer/);
  });

  it('keeps the unbound form usable for library callers', async () => {
    const signer = createKeypairFileSigner(keyFile(keypair.secret()));

    const signed = await signer.signTransaction(
      buildTx(keypair.publicKey(), Networks.PUBLIC),
      Networks.PUBLIC
    );

    expect(TransactionBuilder.fromXDR(signed, Networks.PUBLIC).signatures).toHaveLength(1);
  });

  it('rejects a key file that does not hold a secret key', () => {
    expect(() => createKeypairFileSigner(keyFile(keypair.publicKey()))).toThrow(
      /does not contain a valid Stellar secret key/
    );
  });
});

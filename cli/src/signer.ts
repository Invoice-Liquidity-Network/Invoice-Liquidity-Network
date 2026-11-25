import { FeeBumpTransaction, Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';

import type { TransactionSigner } from './types';

export interface KeypairFileSignerOptions {
  /**
   * The network passphrase of the active profile. When set, the signer refuses
   * to sign for any other network, so a key loaded for one network cannot be
   * driven into signing another network's transaction (#1491).
   */
  networkPassphrase?: string;
}

export function createKeypairFileSigner(
  keypairPath: string,
  options: KeypairFileSignerOptions = {}
): TransactionSigner {
  const secretKey = readSecretFromFile(keypairPath);
  const keypair = Keypair.fromSecret(secretKey);

  return {
    async getPublicKey() {
      return keypair.publicKey();
    },
    async signTransaction(transactionXdr: string, networkPassphrase: string) {
      if (
        options.networkPassphrase !== undefined &&
        networkPassphrase !== options.networkPassphrase
      ) {
        throw new Error(
          'Refusing to sign: transaction network passphrase does not match the active profile network.'
        );
      }

      const transaction = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
      // The CLI only signs transactions it built with this key as source. A
      // foreign source means the XDR came from somewhere else (#1491).
      const source =
        transaction instanceof FeeBumpTransaction ? transaction.feeSource : transaction.source;
      if (source !== keypair.publicKey()) {
        throw new Error(
          `Refusing to sign: transaction source ${source} is not the configured signer ${keypair.publicKey()}.`
        );
      }

      transaction.sign(keypair);
      return transaction.toXDR();
    },
  };
}

function readSecretFromFile(keypairPath: string): string {
  let content: string;

  try {
    content = readFileSync(keypairPath, 'utf8').trim();
  } catch (error) {
    throw new Error(
      `Failed to read keypair file at ${keypairPath}: ${
        error instanceof Error ? error.message : 'unknown error'
      }.`
    );
  }

  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content) as { secretKey?: string; secret?: string };
      const secret = parsed.secretKey ?? parsed.secret;
      if (secret) {
        return secret.trim();
      }
    } catch {
      // fall back to raw secret validation below
    }
  }

  if (!content.startsWith('S')) {
    throw new Error(`Keypair file ${keypairPath} does not contain a valid Stellar secret key.`);
  }

  return content;
}

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';

import type { TransactionSigner } from './types';

export function createKeypairFileSigner(keypairPath: string): TransactionSigner {
  const secretKey = readSecretFromFile(keypairPath);
  const keypair = Keypair.fromSecret(secretKey);

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

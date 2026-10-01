import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import type { NetworkConfig, SignTransactionOptions, TransactionSigner } from '../types';
import { buildSigningDeepLink, waitForDeepLinkCallback, buildCallbackUrl } from './deep-links';
import { getPlatformAdapter } from './platform';

const TESTNET_CONTRACT_ID = 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC';
const TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org';

export const ILN_TESTNET_MOBILE: NetworkConfig = {
  contractId: TESTNET_CONTRACT_ID,
  rpcUrl: TESTNET_RPC_URL,
  networkPassphrase: Networks.TESTNET,
};

export function createMobileKeypairSigner(secretKey: string): TransactionSigner {
  const keypair = Keypair.fromSecret(secretKey);

  return {
    async getPublicKey() {
      return keypair.publicKey();
    },
    async signTransaction(transactionXdr: string, options: SignTransactionOptions) {
      const transaction = TransactionBuilder.fromXDR(transactionXdr, options.networkPassphrase);

      transaction.sign(keypair);
      return transaction.toXDR();
    },
  };
}

export interface MobileWalletConfig {
  walletScheme?: string;
  callbackScheme?: string;
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<MobileWalletConfig> = {
  walletScheme: 'lobstr://',
  callbackScheme: 'ilnsdk',
  timeoutMs: 120_000,
};

const KNOWN_WALLETS = [
  { name: 'Lobstr', scheme: 'lobstr://', universalLink: 'https://lobstr.co/' },
  { name: 'StellarX', scheme: 'stellarx://', universalLink: 'https://stellarx.com/' },
  { name: 'Albedo', scheme: 'albedo://', universalLink: 'https://albedo.link/' },
  { name: 'Rabet', scheme: 'rabet://', universalLink: 'https://rabet.io/' },
  { name: 'Solar', scheme: 'solar://', universalLink: 'https://solarwallet.io/' },
] as const;

function buildWalletDeepLink(
  transactionXdr: string,
  networkPassphrase: string,
  callbackUrl: string,
  walletScheme: string
): string {
  const signingUri = buildSigningDeepLink(transactionXdr, networkPassphrase, callbackUrl);

  if (walletScheme.endsWith('://')) {
    const base = walletScheme.slice(0, -1);
    return `${base}/sign?uri=${encodeURIComponent(signingUri)}`;
  }

  return `${walletScheme}sign?uri=${encodeURIComponent(signingUri)}`;
}

export function createDeepLinkSigner(
  publicKey: string,
  config?: MobileWalletConfig
): TransactionSigner {
  const merged = { ...DEFAULT_CONFIG, ...config };

  return {
    async getPublicKey() {
      return publicKey;
    },

    async signTransaction(transactionXdr: string, options: SignTransactionOptions) {
      const adapter = getPlatformAdapter();
      const callbackUrl = buildCallbackUrl(merged.callbackScheme);
      const walletUrl = buildWalletDeepLink(
        transactionXdr,
        options.networkPassphrase,
        callbackUrl,
        merged.walletScheme
      );

      const callbackPromise = waitForDeepLinkCallback(merged.timeoutMs);

      await adapter.openURL(walletUrl);

      const callbackUrlResult = await callbackPromise;
      const { extractSignedXDRFromCallback } = await import('./deep-links');
      const signedXdr = extractSignedXDRFromCallback(callbackUrlResult);

      if (!signedXdr) {
        throw new Error('No signed transaction returned from wallet');
      }

      return signedXdr;
    },
  };
}

export function getSupportedMobileWallets(): Array<{
  name: string;
  scheme: string;
  universalLink: string;
}> {
  return [...KNOWN_WALLETS];
}

export function resolveWalletDeepLink(walletNameOrScheme: string): string {
  const wallet = KNOWN_WALLETS.find(
    (w) =>
      w.name.toLowerCase() === walletNameOrScheme.toLowerCase() || w.scheme === walletNameOrScheme
  );

  if (wallet) return wallet.scheme;
  if (walletNameOrScheme.includes('://')) return walletNameOrScheme;
  return `https://${walletNameOrScheme}/`;
}

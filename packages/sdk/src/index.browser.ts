// Browser-specific entry point for the ILN SDK.
// Relies on Web Crypto API instead of Node.js crypto.
export * from './clients/InvoiceClient';
export * from './events';
export * from './reputation';
export * from './crypto-browser';
export * from './tokens';
export * from './amount-formatting';

import type { InvoiceTransactionSigner } from './clients/InvoiceClient';

async function loadFreighter(): Promise<{
  getAddress: () => Promise<{ address?: string; error?: unknown }>;
  getNetworkDetails?: () => Promise<{ networkPassphrase?: string; error?: unknown }>;
  isConnected?: () => Promise<{ isConnected?: boolean; error?: unknown }>;
  requestAccess: () => Promise<{ address?: string; error?: unknown }>;
  signTransaction: (
    transactionXdr: string,
    options: { address?: string; networkPassphrase: string },
  ) => Promise<{ error?: unknown; signedTxXdr?: string }>;
}> {
  if (typeof window === 'undefined') {
    throw new Error('Freighter signing is only available in browser environments.');
  }
  const freighter = await import('@stellar/freighter-api');
  const connected = freighter.isConnected ? await freighter.isConnected() : undefined;
  if (connected?.error) {
    throw new Error(String(connected.error));
  }
  if (connected && !connected.isConnected) {
    throw new Error('Freighter extension is not installed or not available.');
  }
  return freighter as typeof import('@stellar/freighter-api');
}

async function resolveFreighterAddress(
  freighter: Awaited<ReturnType<typeof loadFreighter>>,
): Promise<string> {
  const current = await freighter.getAddress();
  if (current.error) {
    throw new Error(String(current.error));
  }
  if (current.address) {
    return current.address;
  }
  const requested = await freighter.requestAccess();
  if (requested.error || !requested.address) {
    throw new Error(
      requested.error ? String(requested.error) : 'Freighter did not provide an account address.',
    );
  }
  return requested.address;
}

export function createFreighterSigner(address?: string): InvoiceTransactionSigner {
  return {
    async getPublicKey() {
      const freighter = await loadFreighter();
      return address ?? (await resolveFreighterAddress(freighter));
    },
    async signTransaction(transactionXdr: string, options: { address?: string; networkPassphrase: string }) {
      const freighter = await loadFreighter();
      const selected = options.address ?? address ?? (await resolveFreighterAddress(freighter));
      const networkDetails = freighter.getNetworkDetails
        ? await freighter.getNetworkDetails()
        : null;
      if (networkDetails && !networkDetails.error) {
        const passphrase = (networkDetails as { networkPassphrase?: string }).networkPassphrase;
        if (passphrase && passphrase !== options.networkPassphrase) {
          throw new Error('Freighter is connected to a different Stellar network.');
        }
      }
      const result = await freighter.signTransaction(transactionXdr, {
        address: selected,
        networkPassphrase: options.networkPassphrase,
      });
      if (result.error || !result.signedTxXdr) {
        throw new Error(
          result.error ? String(result.error) : 'Freighter did not return a signed transaction.',
        );
      }
      return result.signedTxXdr;
    },
  };
}

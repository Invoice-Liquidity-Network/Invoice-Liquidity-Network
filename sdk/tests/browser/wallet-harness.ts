/**
 * Browser harness that loads the real `createFreighterSigner` implementation
 * against the Freighter API mock (Vite-aliased). Exposes helpers on
 * `window.__ilnWallet` for Playwright assertions.
 */
import { Networks } from '@stellar/stellar-sdk';

// Eagerly install window.__freighterMock before any signer calls.
// createFreighterSigner dynamically imports the same module via the Vite alias
// `@stellar/freighter-api` → ./freighter-api-mock.ts (same resolved file).
import './freighter-api-mock';

import { createFreighterSigner } from '../../src/signers';

const TESTNET = Networks.TESTNET;
const PUBLIC = Networks.PUBLIC;

async function ensureReady(): Promise<void> {
  if (!window.__freighterMock) {
    throw new Error('Freighter mock control surface was not installed');
  }
}

declare global {
  interface Window {
    __ilnWallet?: {
      ready: boolean;
      error: string | null;
      Networks: { TESTNET: string; PUBLIC: string };
      resetMock: () => void;
      configureMock: (partial: Record<string, unknown>) => void;
      getMockCalls: () => Array<{ method: string; args: unknown[] }>;
      getPublicKey: (address?: string) => Promise<string>;
      signTransaction: (
        xdr: string,
        options: { networkPassphrase: string; address?: string },
        signerAddress?: string
      ) => Promise<string>;
    };
    __ilnWalletReady?: boolean;
    __ilnWalletError?: string | null;
  }
}

try {
  window.__ilnWallet = {
    ready: true,
    error: null,
    Networks: { TESTNET, PUBLIC },
    resetMock() {
      window.__freighterMock?.reset();
    },
    configureMock(partial) {
      window.__freighterMock?.configure(partial);
    },
    getMockCalls() {
      return window.__freighterMock?.getCalls() ?? [];
    },
    async getPublicKey(address?: string) {
      await ensureReady();
      const signer = createFreighterSigner(address);
      return signer.getPublicKey();
    },
    async signTransaction(xdr, options, signerAddress?) {
      await ensureReady();
      const signer = createFreighterSigner(signerAddress);
      return signer.signTransaction(xdr, options);
    },
  };
  window.__ilnWalletReady = true;
  window.__ilnWalletError = null;
} catch (err) {
  window.__ilnWalletReady = false;
  window.__ilnWalletError = err instanceof Error ? err.message : String(err);
}

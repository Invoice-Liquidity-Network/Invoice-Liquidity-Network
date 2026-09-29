/**
 * Resolved by the closure of docs/sdk-integration-fixture-audit.md (issue #1093).
 *
 * `toTransactionSigner()` returns the real `@iln/sdk` `TransactionSigner` type, so a
 * breaking change to that interface fails this file's typecheck instead of silently
 * drifting. The connect/disconnect/event surface below stays wallet-lifecycle-shaped
 * (not SDK-shaped) on purpose — it emulates the *UX* of connecting a browser wallet
 * (Freighter-style), which the SDK's signer contract deliberately has no opinion on.
 */
import { EventEmitter } from 'events';
import type { SignTransactionOptions, TransactionSigner } from '@iln/sdk';

export interface MockWalletOptions {
  address?: string;
}

export class MockWallet extends EventEmitter {
  address: string;

  constructor(opts: MockWalletOptions = {}) {
    super();
    this.address = opts.address ?? 'GMOCKWALLETADDRESS000000000000000000000';
  }

  async connect() {
    this.emit('connect', { address: this.address });
    return { address: this.address };
  }

  async disconnect() {
    this.emit('disconnect');
  }

  /**
   * Adapts this wallet emulator to the real SDK signer contract. Passing the
   * result to `new ILNSdk({ signer: ... })` is how integration tests exercise
   * SDK code paths that require a `TransactionSigner`, without depending on
   * a browser extension or a live key.
   */
  toTransactionSigner(): TransactionSigner {
    return {
      getPublicKey: async () => this.address,
      signTransaction: async (transactionXdr: string, _options: SignTransactionOptions) => {
        // A mock signer does not need to hold a real key: it echoes the input XDR
        // back unchanged, which is sufficient for tests that assert the SDK
        // *called* the signer correctly rather than verifying a real signature.
        return transactionXdr;
      },
    };
  }

  async signMessage(message: string) {
    return {
      message,
      signature: 'MOCK_MESSAGE_SIGNATURE',
      signer: this.address,
    };
  }
}

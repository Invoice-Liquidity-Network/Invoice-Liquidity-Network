/**
 * @todo audit-sdk-fixtures
 * Periodically review this mock against the real SDK wallet interface to catch
 * API drift. If the SDK's wallet contract changes, update or retire this fixture.
 */
import { EventEmitter } from 'events';

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

  async signTransaction(tx: unknown) {
    // Return a lightweight mock signature structure
    return {
      tx,
      signature: 'MOCK_SIGNATURE',
      signer: this.address,
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

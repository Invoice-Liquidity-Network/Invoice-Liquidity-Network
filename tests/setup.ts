import { Keypair } from '@stellar/stellar-sdk';
import { vi } from 'vitest';

// ── Wallet / signer mocks ─────────────────────────────────────────────────────

export function makeKeypair() {
  return Keypair.random();
}

export function makeAddress(seed?: string): string {
  return seed
    ? Keypair.fromRawEd25519Seed(Buffer.alloc(32, seed)).publicKey()
    : Keypair.random().publicKey();
}

/** Minimal RPC server mock — override individual methods per test. */
export function makeRpcServer() {
  return {
    getAccount: vi.fn(),
    prepareTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    pollTransaction: vi.fn(),
    simulateTransaction: vi.fn(),
  };
}

// ── Contract fixtures ─────────────────────────────────────────────────────────

export const TEST_CONTRACT_ID = 'CCPASLHKRFBMVV5PZG3LKDGKFEDXZMB5U7DK42CVLUVWCMUCSRPVBIMO';
export const TEST_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const TEST_RPC_URL = 'https://soroban-testnet.stellar.org';

export function makeInvoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    freelancer: makeAddress('freelancer'),
    payer: makeAddress('payer'),
    amount: 1_000_000_000n,
    amountFunded: 0n,
    discountRate: 300,
    dueDate: 1_767_225_599,
    status: 'Pending',
    funder: null,
    fundedAt: null,
    token: TEST_CONTRACT_ID,
    ...overrides,
  };
}

import { describe, expect, it, vi } from 'vitest';
import { ILNSdk } from './client';
import { KNOWN_OFFICIAL_CONTRACT_IDS, verifyContractId } from './registry';
import type { RpcServerLike } from './types';

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const OFFICIAL_CONTRACT_ID = 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC';
const UNKNOWN_CONTRACT_ID = 'CUNKNOWN123456789012345678901234567890123456789012345678';

const mockServer: RpcServerLike = {
  getAccount: vi.fn(),
  prepareTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  pollTransaction: vi.fn(),
  simulateTransaction: vi.fn(),
};

describe('contractId Mismatch Detection Sanity Check', () => {
  it('verifyContractId identifies official contract IDs', () => {
    const result = verifyContractId(OFFICIAL_CONTRACT_ID);
    expect(result.isOfficial).toBe(true);
    expect(result.warningMessage).toBeUndefined();
  });

  it('verifyContractId identifies unrecognized contract IDs and generates warning message', () => {
    const result = verifyContractId(UNKNOWN_CONTRACT_ID);
    expect(result.isOfficial).toBe(false);
    expect(result.warningMessage).toContain('[ILNSdk WARNING]');
    expect(result.warningMessage).toContain(UNKNOWN_CONTRACT_ID);
    expect(result.warningMessage).toContain('does not match any known official ILN deployment');
  });

  it('initializes without warning when contractId matches a known official deployment', () => {
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new ILNSdk({
      contractId: OFFICIAL_CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: 'https://example.test',
      server: mockServer,
    });

    expect(spyWarn).not.toHaveBeenCalled();
    spyWarn.mockRestore();
  });

  it('logs loud warning on initialization when contractId does not match known official deployment', () => {
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new ILNSdk({
      contractId: UNKNOWN_CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: 'https://example.test',
      server: mockServer,
    });

    expect(spyWarn).toHaveBeenCalledTimes(1);
    expect(spyWarn.mock.calls[0][0]).toContain('[ILNSdk WARNING]');
    expect(spyWarn.mock.calls[0][0]).toContain(UNKNOWN_CONTRACT_ID);
    expect(spyWarn.mock.calls[0][0]).toContain('does not match any known official ILN deployment');

    spyWarn.mockRestore();
  });

  it('suppresses warning when verifyContractId is explicitly set to false', () => {
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new ILNSdk({
      contractId: UNKNOWN_CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: 'https://example.test',
      server: mockServer,
      verifyContractId: false,
    });

    expect(spyWarn).not.toHaveBeenCalled();
    spyWarn.mockRestore();
  });
});

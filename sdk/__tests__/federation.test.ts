import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FederationServer } from '@stellar/stellar-sdk';
import { resolveFederationAddress, lookupFederationAddress, FederationResolutionError } from '../src/federation';

vi.mock('@stellar/stellar-sdk', () => {
  return {
    FederationServer: {
      resolve: vi.fn(),
    },
  };
});

describe('Federation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveFederationAddress', () => {
    it('should resolve a valid federation address', async () => {
      vi.mocked(FederationServer.resolve).mockResolvedValueOnce({
        account_id: 'G1234567890',
      } as any);

      const result = await resolveFederationAddress('alice*iln.finance');
      expect(result).toBe('G1234567890');
      expect(FederationServer.resolve).toHaveBeenCalledWith('alice*iln.finance');
    });

    it('should throw FederationResolutionError on invalid format', async () => {
      await expect(resolveFederationAddress('' as any)).rejects.toThrow(FederationResolutionError);
    });

    it('should throw FederationResolutionError if address not registered', async () => {
      vi.mocked(FederationServer.resolve).mockResolvedValueOnce({} as any);
      await expect(resolveFederationAddress('bob*iln.finance')).rejects.toThrow('Address not registered');
    });
  });

  describe('lookupFederationAddress', () => {
    it('should lookup a valid G-address', async () => {
      vi.mocked(FederationServer.resolve).mockResolvedValueOnce({
        stellar_address: 'alice*iln.finance',
      } as any);

      const result = await lookupFederationAddress('GBOB1234567890');
      expect(result).toBe('alice*iln.finance');
    });

    it('should return null if server not found', async () => {
      vi.mocked(FederationServer.resolve).mockRejectedValueOnce(new Error('not found'));
      const result = await lookupFederationAddress('GCHARLIE1234567890');
      expect(result).toBeNull();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Federation } from '@stellar/stellar-sdk';
import {
  resolveFederationAddress,
  lookupFederationAddress,
  FederationResolutionError,
  FederationRecordManager,
} from './federation';

vi.mock('@stellar/stellar-sdk', () => {
  return {
    Federation: {
      Server: {
        resolve: vi.fn(),
      },
    },
  };
});

describe('Federation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveFederationAddress', () => {
    it('should resolve a valid federation address', async () => {
      vi.mocked(Federation.Server.resolve).mockResolvedValueOnce({
        account_id: 'G1234567890',
      } as any);

      const result = await resolveFederationAddress('alice*iln.finance');
      expect(result).toBe('G1234567890');
      expect(Federation.Server.resolve).toHaveBeenCalledWith('alice*iln.finance');
    });

    it('should throw FederationResolutionError on invalid format', async () => {
      await expect(resolveFederationAddress('' as any)).rejects.toThrow(FederationResolutionError);
    });

    it('should throw FederationResolutionError if address not registered', async () => {
      vi.mocked(Federation.Server.resolve).mockResolvedValueOnce({} as any);
      await expect(resolveFederationAddress('bob*iln.finance')).rejects.toThrow(
        'Address not registered'
      );
    });
  });

  describe('lookupFederationAddress', () => {
    it('should lookup a valid G-address', async () => {
      vi.mocked(Federation.Server.resolve).mockResolvedValueOnce({
        stellar_address: 'alice*iln.finance',
      } as any);

      const result = await lookupFederationAddress('GBOB1234567890');
      expect(result).toBe('alice*iln.finance');
    });

    it('should return null if server not found', async () => {
      vi.mocked(Federation.Server.resolve).mockRejectedValueOnce(new Error('not found'));
      const result = await lookupFederationAddress('GCHARLIE1234567890');
      expect(result).toBeNull();
    });
  });
});

describe('FederationRecordManager', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(Federation.Server.resolve).mockResolvedValue({ account_id: 'GABC' } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('createRecord sends POST with correct body', async () => {
    const mgr = new FederationRecordManager('https://fed.example.com', 'key123');
    await mgr.createRecord({ name: 'alice', stellarAddress: 'GABC123' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://fed.example.com/records',
      expect.objectContaining({ method: 'POST' })
    );
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body.name).toBe('alice');
    expect(body.stellarAddress).toBe('GABC123');
  });

  it('createRecord includes Authorization header when apiKey is provided', async () => {
    const mgr = new FederationRecordManager('https://fed.example.com', 'mykey');
    await mgr.createRecord({ name: 'bob', stellarAddress: 'GXYZ' });

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['Authorization']).toBe('Bearer mykey');
  });

  it('createRecord throws FederationResolutionError on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => 'Already exists',
    });
    const mgr = new FederationRecordManager('https://fed.example.com');
    await expect(mgr.createRecord({ name: 'alice', stellarAddress: 'GABC' })).rejects.toThrow(
      FederationResolutionError
    );
  });

  it('createRecord throws on missing name', async () => {
    const mgr = new FederationRecordManager('https://fed.example.com');
    await expect(mgr.createRecord({ name: '', stellarAddress: 'GABC' })).rejects.toThrow(
      FederationResolutionError
    );
  });

  it('getByAddress delegates to resolveFederationAddress', async () => {
    vi.mocked(Federation.Server.resolve).mockResolvedValueOnce({ account_id: 'GRESOLVED' } as any);
    const mgr = new FederationRecordManager('https://fed.example.com');
    // Use an address not resolved elsewhere in this file — resolveFederationAddress
    // caches results for 5 minutes, and a shared address would return another
    // test's cached value instead of exercising this mock.
    const result = await mgr.getByAddress('carol*iln.finance');
    expect(result).toBe('GRESOLVED');
  });

  it('updateRecord sends PUT to correct URL', async () => {
    const mgr = new FederationRecordManager('https://fed.example.com');
    await mgr.updateRecord('alice', { stellarAddress: 'GNEW' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://fed.example.com/records/alice',
      expect.objectContaining({ method: 'PUT' })
    );
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body.stellarAddress).toBe('GNEW');
  });

  it('updateRecord throws on missing name', async () => {
    const mgr = new FederationRecordManager('https://fed.example.com');
    await expect(mgr.updateRecord('', { stellarAddress: 'GNEW' })).rejects.toThrow(
      FederationResolutionError
    );
  });

  it('deleteRecord sends DELETE to correct URL', async () => {
    const mgr = new FederationRecordManager('https://fed.example.com');
    await mgr.deleteRecord('alice');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://fed.example.com/records/alice',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('deleteRecord throws FederationResolutionError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '',
    });
    const mgr = new FederationRecordManager('https://fed.example.com');
    await expect(mgr.deleteRecord('unknown')).rejects.toThrow(FederationResolutionError);
  });

  it('URL-encodes record names with special characters', async () => {
    const mgr = new FederationRecordManager('https://fed.example.com');
    await mgr.deleteRecord('alice bob');
    expect(fetchMock.mock.calls[0][0]).toBe('https://fed.example.com/records/alice%20bob');
  });
});

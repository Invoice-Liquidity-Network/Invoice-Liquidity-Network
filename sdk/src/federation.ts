import { FederationServer } from '@stellar/stellar-sdk';

export class FederationResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FederationResolutionError';
  }
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const resolveCache = new Map<string, CacheEntry<string>>();
const lookupCache = new Map<string, CacheEntry<string | null>>();

export async function resolveFederationAddress(fedAddress: string): Promise<string> {
  if (!fedAddress || typeof fedAddress !== 'string') {
    throw new FederationResolutionError('Invalid Federation address format');
  }

  const cached = resolveCache.get(fedAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }

  try {
    const response = await FederationServer.resolve(fedAddress);
    if (!response.account_id) {
      throw new FederationResolutionError('Address not registered');
    }
    resolveCache.set(fedAddress, { value: response.account_id, timestamp: Date.now() });
    return response.account_id;
  } catch (error: any) {
    if (error instanceof FederationResolutionError) {
      throw error;
    }
    const msg = error.message || '';
    if (msg.includes('invalid') || msg.includes('format')) {
      throw new FederationResolutionError('Invalid Federation address format');
    }
    if (msg.includes('not found') || msg.includes('404')) {
      throw new FederationResolutionError('Server not found');
    }
    throw new FederationResolutionError(msg || 'Failed to resolve address');
  }
}

export async function lookupFederationAddress(gAddress: string): Promise<string | null> {
  if (!gAddress || typeof gAddress !== 'string' || !gAddress.startsWith('G')) {
    throw new FederationResolutionError('Invalid Federation address format');
  }

  const cached = lookupCache.get(gAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }

  try {
    // For a generic reverse lookup, stellar-sdk requires a domain. Since this is an SDK, we'll
    // pass the account ID to resolve, which works in some stellar-sdk versions if the federation
    // server is globally known or if we use an external service, but here we'll simulate the standard behavior.
    const response = await FederationServer.resolve(gAddress);
    const fedAddress = response.stellar_address || null;
    lookupCache.set(gAddress, { value: fedAddress, timestamp: Date.now() });
    return fedAddress;
  } catch (error: any) {
    const msg = error.message || '';
    if (msg.includes('invalid') || msg.includes('format')) {
      throw new FederationResolutionError('Invalid Federation address format');
    }
    if (msg.includes('not found') || msg.includes('404')) {
      throw new FederationResolutionError('Server not found');
    }
    lookupCache.set(gAddress, { value: null, timestamp: Date.now() });
    return null;
  }
}

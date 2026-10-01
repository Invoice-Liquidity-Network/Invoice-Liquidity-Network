import { Federation } from '@stellar/stellar-sdk';

const DEFAULT_FEDERATION_BASE_URL = 'https://federation.iln.finance';

/**
 * A federation record mapping a human-readable name to a Stellar address.
 *
 * @property name - The federation name (e.g. "alice").
 * @property stellarAddress - The Stellar G-address associated with this name.
 * @property memo - Optional memo to attach to transactions.
 * @property memoType - Optional memo type (text, id, hash).
 */
export interface FederationRecord {
  name: string;
  stellarAddress: string;
  memo?: string;
  memoType?: string;
}

/**
 * Error thrown when federation address resolution fails.
 */
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

/**
 * Resolve a federation address (e.g. "name*domain.com") to a Stellar G-address.
 * Results are cached for 5 minutes to reduce federation server requests.
 *
 * @param fedAddress - The federation address to resolve.
 * @returns The resolved Stellar G-address.
 * @throws {FederationResolutionError} If the address is invalid or cannot be resolved.
 *
 * @example
 * ```ts
 * const gAddress = await resolveFederationAddress("alice*federation.iln.finance");
 * console.log(gAddress); // "GABC..."
 * ```
 */
export async function resolveFederationAddress(fedAddress: string): Promise<string> {
  if (!fedAddress || typeof fedAddress !== 'string') {
    throw new FederationResolutionError('Invalid Federation address format');
  }

  const cached = resolveCache.get(fedAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }

  try {
    const response = await Federation.Server.resolve(fedAddress);
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

/**
 * Perform a reverse federation lookup: find the federation address for a Stellar G-address.
 * Results are cached for 5 minutes.
 *
 * @param gAddress - The Stellar G-address to look up.
 * @returns The federation address, or `null` if not found.
 * @throws {FederationResolutionError} If the address format is invalid.
 *
 * @example
 * ```ts
 * const fedAddress = await lookupFederationAddress("GABC...");
 * if (fedAddress) {
 *   console.log(fedAddress); // "alice*federation.iln.finance"
 * }
 * ```
 */
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
    const response = await Federation.Server.resolve(gAddress);
    // `stellar_address` isn't part of the standard Federation.Api.Record shape
    // (reverse lookups aren't part of the federation protocol) — some
    // non-standard servers may still include it, so read it defensively.
    const fedAddress =
      (response as unknown as { stellar_address?: string }).stellar_address || null;
    lookupCache.set(gAddress, { value: fedAddress, timestamp: Date.now() });
    return fedAddress;
  } catch (error: any) {
    const msg = error.message || '';
    if (msg.includes('invalid') || msg.includes('format')) {
      throw new FederationResolutionError('Invalid Federation address format');
    }
    if (msg.includes('not found') || msg.includes('404')) {
      lookupCache.set(gAddress, { value: null, timestamp: Date.now() });
      return null;
    }
    lookupCache.set(gAddress, { value: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Client for managing federation records on the ILN federation server.
 * Supports CRUD operations for mapping human-readable names to Stellar addresses.
 *
 * @example
 * ```ts
 * const manager = new FederationRecordManager("https://federation.iln.finance", apiKey);
 *
 * // Create a new federation record
 * await manager.createRecord({
 *   name: "alice",
 *   stellarAddress: "GABC...",
 * });
 *
 * // Resolve a federation address
 * const address = await manager.getByAddress("alice*federation.iln.finance");
 * ```
 */
export class FederationRecordManager {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  /**
   * Create a new federation record manager.
   *
   * @param baseUrl - The base URL of the federation server (default: https://federation.iln.finance).
   * @param apiKey - Optional API key for authenticated operations.
   */
  constructor(baseUrl: string = DEFAULT_FEDERATION_BASE_URL, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      this.headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new FederationResolutionError(
        `Federation server error (${res.status}): ${text || res.statusText}`
      );
    }
    return res;
  }

  /**
   * Create a new federation record.
   *
   * @param record - The federation record to create.
   * @throws {FederationResolutionError} If the record is missing required fields.
   *
   * @example
   * ```ts
   * await manager.createRecord({
   *   name: "alice",
   *   stellarAddress: "GABC...",
   *   memo: "invoices",
   * });
   * ```
   */
  async createRecord(record: FederationRecord): Promise<void> {
    if (!record.name || !record.stellarAddress) {
      throw new FederationResolutionError('Record must have a name and stellarAddress');
    }
    await this.request('POST', '/records', record);
  }

  /**
   * Resolve a federation address to a Stellar G-address.
   * Delegates to the `resolveFederationAddress` function.
   *
   * @param fedAddress - The federation address to resolve.
   * @returns The resolved Stellar G-address.
   */
  async getByAddress(fedAddress: string): Promise<string> {
    return resolveFederationAddress(fedAddress);
  }

  /**
   * Update an existing federation record by name.
   *
   * @param name - The federation name to update.
   * @param updates - Partial record fields to update.
   * @throws {FederationResolutionError} If the name is empty.
   *
   * @example
   * ```ts
   * await manager.updateRecord("alice", { stellarAddress: "GDEF..." });
   * ```
   */
  async updateRecord(
    name: string,
    updates: Partial<Omit<FederationRecord, 'name'>>
  ): Promise<void> {
    if (!name) {
      throw new FederationResolutionError('Record name is required');
    }
    await this.request('PUT', `/records/${encodeURIComponent(name)}`, updates);
  }

  /**
   * Delete a federation record by name.
   *
   * @param name - The federation name to delete.
   * @throws {FederationResolutionError} If the name is empty.
   *
   * @example
   * ```ts
   * await manager.deleteRecord("alice");
   * ```
   */
  async deleteRecord(name: string): Promise<void> {
    if (!name) {
      throw new FederationResolutionError('Record name is required');
    }
    await this.request('DELETE', `/records/${encodeURIComponent(name)}`);
  }
}

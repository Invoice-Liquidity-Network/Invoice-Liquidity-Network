import { createClient, type RedisClientType } from 'redis';

import type {
  OracleCacheEntry,
  OracleCacheReaderWriter,
  OracleVerificationRequest,
  OracleVerificationResponse,
} from './types';

const DEFAULT_TTL_SECONDS = 300;

function normalizeCacheKeyComponent(value: string | number | bigint): string {
  return String(value).trim().toLowerCase();
}

export function buildOracleCacheKey(request: OracleVerificationRequest): string {
  return [
    'oracle',
    'v1',
    normalizeCacheKeyComponent(request.payer),
    normalizeCacheKeyComponent(request.amount),
    normalizeCacheKeyComponent(request.invoiceId),
  ].join(':');
}

class InMemoryOracleCache implements OracleCacheReaderWriter {
  private readonly entries = new Map<string, OracleCacheEntry & { expiresAtMs: number }>();
  /**
   * Last-known-good store for degraded mode (issue #1057): updated on every
   * set, never evicted by TTL, so a total source outage can still serve the
   * most recent answer marked stale.
   */
  private readonly lastKnown = new Map<string, OracleCacheEntry>();

  async get(key: string): Promise<OracleCacheEntry | null> {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    return {
      key: entry.key,
      response: entry.response,
      generatedAtMs: entry.generatedAtMs,
    };
  }

  async set(
    key: string,
    response: OracleVerificationResponse,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    const generatedAtMs = Date.parse(response.generatedAt) || Date.now();
    this.entries.set(key, {
      key,
      response,
      generatedAtMs,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    });
    this.lastKnown.set(key, { key, response, generatedAtMs });
  }

  async getStale(key: string): Promise<OracleCacheEntry | null> {
    const entry = this.lastKnown.get(key);
    if (!entry) {
      return null;
    }
    return { key: entry.key, response: entry.response, generatedAtMs: entry.generatedAtMs };
  }
}

class RedisOracleCache implements OracleCacheReaderWriter {
  constructor(private readonly client: RedisClientType) {}

  async get(key: string): Promise<OracleCacheEntry | null> {
    const raw = await this.client.get(key);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as OracleCacheEntry;
      return parsed;
    } catch {
      return null;
    }
  }

  async set(
    key: string,
    response: OracleVerificationResponse,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    const payload: OracleCacheEntry = {
      key,
      response,
      generatedAtMs: Date.parse(response.generatedAt) || Date.now(),
    };

    await this.client.set(key, JSON.stringify(payload), {
      EX: ttlSeconds,
    });
    // Last-known-good backup for degraded mode (issue #1057): a separate
    // key with a long TTL so a total source outage can still serve the most
    // recent answer marked stale.
    await this.client.set(`${key}:stale`, JSON.stringify(payload), {
      EX: 24 * 60 * 60,
    });
  }

  async getStale(key: string): Promise<OracleCacheEntry | null> {
    const raw = await this.client.get(`${key}:stale`);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as OracleCacheEntry;
    } catch {
      return null;
    }
  }
}

export interface CreateOracleCacheOptions {
  redisUrl?: string;
  ttlSeconds?: number;
}

export interface ResolvedOracleCache {
  cache: OracleCacheReaderWriter;
  kind: 'memory' | 'redis';
  close(): Promise<void>;
}

export async function createOracleCache(
  options: CreateOracleCacheOptions = {}
): Promise<ResolvedOracleCache> {
  if (!options.redisUrl) {
    return {
      cache: new InMemoryOracleCache(),
      kind: 'memory',
      async close() {},
    };
  }

  const client = createClient({ url: options.redisUrl });
  client.on('error', (error) => {
    console.error('[oracle-cache] redis error', error);
  });
  await client.connect();

  return {
    cache: new RedisOracleCache(client),
    kind: 'redis',
    async close() {
      await client.quit();
    },
  };
}

export function createEphemeralOracleCache(): OracleCacheReaderWriter {
  return new InMemoryOracleCache();
}

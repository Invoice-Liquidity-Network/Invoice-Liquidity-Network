import { createClient, type RedisClientType } from 'redis';

import type {
  OracleCacheEntry,
  OracleCacheReaderWriter,
  OracleVerificationRequest,
  OracleVerificationResponse,
} from './types';

export const DEFAULT_TTL_SECONDS = 300;

/**
 * TTL applied to a *clean* verdict for a payer that has been active inside the
 * rapid-succession fraud window.
 *
 * ── The staleness gap this closes ────────────────────────────────────────────
 *
 * Fraud heuristics are time-sensitive by construction: rapid-succession and
 * similar-amount detection both look at activity in a rolling window. A clean
 * verdict is therefore only true as of the moment it was computed. Caching it
 * for the full 300 s creates a window in which a payer who *just* started
 * exhibiting fraud patterns still reads as clean — precisely the window an
 * attacker wants, since the heuristics that would flag them are the ones being
 * bypassed.
 *
 * The mitigation is asymmetric, and deliberately so:
 *
 *   - A cached **clean** verdict going stale is a security failure: bad actors
 *     read as good. Those entries get a short TTL.
 *   - A cached **flagged** verdict going stale is not: good actors read as bad.
 *     That fails safe, costs only a re-check, and keeps the cache useful as a
 *     shield against an attacker re-querying to grind out a clean result. Those
 *     entries keep the full TTL.
 *
 * 30 s bounds the exposure to roughly one block of activity rather than five
 * minutes, while still absorbing the retry bursts the cache exists to absorb.
 */
export const VOLATILE_CLEAN_TTL_SECONDS = 30;

function normalizeCacheKeyComponent(value: string | number | bigint): string {
  return String(value).trim().toLowerCase();
}

/** Key prefix covering every cached entry for a payer, for bulk invalidation. */
export function buildOraclePayerKeyPrefix(payer: string): string {
  return ['oracle', 'v1', normalizeCacheKeyComponent(payer)].join(':');
}

/**
 * Effective TTL for a response under the policy documented on
 * `VOLATILE_CLEAN_TTL_SECONDS`.
 *
 * `recentActivity` is true when the payer has on-chain activity inside the
 * rapid-succession window — the condition under which a clean verdict is most
 * likely to be invalidated by the payer's very next invoice.
 */
export function resolveCacheTtlSeconds(
  response: Pick<OracleVerificationResponse, 'isVerified' | 'fraudSignals'>,
  baseTtlSeconds: number,
  recentActivity: boolean
): number {
  const isClean = response.isVerified && response.fraudSignals.length === 0;
  if (!isClean) {
    return baseTtlSeconds;
  }
  if (!recentActivity) {
    return baseTtlSeconds;
  }
  return Math.min(baseTtlSeconds, VOLATILE_CLEAN_TTL_SECONDS);
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
  }

  async invalidateByPrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
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
  }

  async invalidateByPrefix(prefix: string): Promise<number> {
    // SCAN rather than KEYS: KEYS blocks the Redis event loop for the whole
    // keyspace, which is not acceptable on a request path.
    let cursor = 0;
    let removed = 0;

    do {
      const batch = await this.client.scan(cursor, { MATCH: `${prefix}*`, COUNT: 200 });
      cursor = Number(batch.cursor);
      if (batch.keys.length > 0) {
        removed += await this.client.del(batch.keys);
      }
    } while (cursor !== 0);

    return removed;
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

/**
 * oracle-service/src/cacheRedis.ts
 *
 * Redis-backed cache implementation for oracle verdicts (issue #1484).
 *
 * Designed to be resilient to:
 *  1. Unavailable cache state: network disconnects, node reboots, Redis outages fail safe
 *     to cache-miss without failing caller requests.
 *  2. Lost writes: write failures or cluster failovers log redacted diagnostics and
 *     resolve safely without corrupting memory or aborting request lifecycles.
 *  3. Split-brain & partitions: monotonic timestamp guards prevent stale partition
 *     writes from rolling back newer verdict publications.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUDIT SPECIFICATION & MATRICES (#1484)
 * ─────────────────────────────────────────────────────────────────────────────
 * - Normal: Read hits return cached verdict, write sets key with EX ttlSeconds and
 *   backup key `${key}:stale` with 24h retention for degraded mode fallback.
 * - Failed: Redis connection drops, timeouts, or command errors during get/set:
 *   - get() logs redacted warning and returns null (cache miss -> recompute from sources).
 *   - set() logs redacted warning and resolves safely (request succeeds, write dropped).
 *   - getStale() logs redacted warning and returns null.
 *   - invalidateByPrefix() logs warning and returns 0.
 * - Repeated: Multiple successive failover events or retry bursts do not leak unhandled
 *   rejections or crash the process event loop.
 * - Stale: Responses carrying generatedAtMs older than current known data cannot overwrite
 *   fresher entries in monotonic mode, preventing split-brain rollback.
 * - Interrupted: Socket termination during multi-command pipeline or scan exits cleanly
 *   without leaving hanging promises.
 *
 * Source of Truth:
 * - Live upstream feeds (indexer, reputation, KYB); Redis serves only as a read-through
 *   performance shield, never as authoritative persistent store.
 *
 * Failure Behavior:
 * - Fail-open to source: Cache unavailability degrades performance but preserves protocol
 *   verification availability.
 *
 * Residual Risk & Maintainer Approval Decisions:
 * - High rate of Redis write failures when down could generate console log noise.
 *   Mitigation: Redacted error logging; error events on client are throttled/handled.
 */

import type { createClient } from 'redis';
import type {
  OracleCacheEntry,
  OracleCacheReaderWriter,
  OracleVerificationResponse,
} from './types';
import { redactErrorMessage } from './redaction';

export type RedisClient = ReturnType<typeof createClient>;

export const DEFAULT_TTL_SECONDS = 300;

export interface RedisOracleCacheOptions {
  client: RedisClient;
  /**
   * When true, enforces monotonic timestamps: if a key already holds a verdict
   * newer than the incoming one (e.g. from a split-brain node), the write is skipped.
   */
  enforceMonotonicWrites?: boolean;
}

export class RedisOracleCache implements OracleCacheReaderWriter {
  private readonly client: RedisClient;
  private readonly enforceMonotonicWrites: boolean;

  constructor(clientOrOptions: RedisClient | RedisOracleCacheOptions) {
    if ('client' in clientOrOptions) {
      this.client = clientOrOptions.client;
      this.enforceMonotonicWrites = clientOrOptions.enforceMonotonicWrites ?? false;
    } else {
      this.client = clientOrOptions;
      this.enforceMonotonicWrites = false;
    }
  }

  async get(key: string): Promise<OracleCacheEntry | null> {
    try {
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
    } catch (error) {
      // Fail safe on unavailable cache state: treat error as cache miss
      console.warn('[oracle-cache] redis get error (failing safe to miss):', redactErrorMessage(error));
      return null;
    }
  }

  async set(
    key: string,
    response: OracleVerificationResponse,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    const generatedAtMs = Date.parse(response.generatedAt) || Date.now();
    const payload: OracleCacheEntry = {
      key,
      response,
      generatedAtMs,
    };

    try {
      if (this.enforceMonotonicWrites) {
        const existing = await this.get(key);
        if (existing && existing.generatedAtMs > generatedAtMs) {
          // Prevent split-brain stale write rollback
          return;
        }
      }

      await this.client.set(key, JSON.stringify(payload), {
        EX: ttlSeconds,
      });

      // Last-known-good backup for degraded mode (issue #1057): a separate
      // key with a long TTL so a total source outage can still serve the most
      // recent answer marked stale.
      await this.client.set(`${key}:stale`, JSON.stringify(payload), {
        EX: 24 * 60 * 60,
      });
    } catch (error) {
      // Fail safe on lost writes: do not abort the verification request
      console.warn('[oracle-cache] redis set error (lost write handled safely):', redactErrorMessage(error));
    }
  }

  async getStale(key: string): Promise<OracleCacheEntry | null> {
    try {
      const raw = await this.client.get(`${key}:stale`);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as OracleCacheEntry;
      } catch {
        return null;
      }
    } catch (error) {
      console.warn('[oracle-cache] redis getStale error (failing safe to null):', redactErrorMessage(error));
      return null;
    }
  }

  async invalidateByPrefix(prefix: string): Promise<number> {
    try {
      let cursor = 0;
      let removed = 0;

      do {
        const batch = await this.client.scan(cursor, { MATCH: `${prefix}*`, COUNT: 200 });
        cursor = Number(batch.cursor);
        if (batch.keys && batch.keys.length > 0) {
          removed += await this.client.del(batch.keys);
        }
      } while (cursor !== 0);

      return removed;
    } catch (error) {
      console.warn('[oracle-cache] redis invalidateByPrefix error:', redactErrorMessage(error));
      return 0;
    }
  }
}

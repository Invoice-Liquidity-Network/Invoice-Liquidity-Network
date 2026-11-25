import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisOracleCache, type RedisClient } from './cacheRedis';
import { makeResponse, TEST_PAYER } from './testFixtures';

interface MockRedisClient {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  scan: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  store: Map<string, string>;
}

function createMockClient(): MockRedisClient {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    scan: vi.fn(async (_cursor: number, opts: { MATCH: string }) => {
      const prefix = opts.MATCH.replace(/\*$/, '');
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return { cursor: 0, keys };
    }),
    del: vi.fn(async (keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    }),
  };
}

describe('Redis cache failover: unavailable cache state (#1484)', () => {
  let mock: MockRedisClient;
  let cache: RedisOracleCache;

  beforeEach(() => {
    mock = createMockClient();
    cache = new RedisOracleCache(mock as unknown as RedisClient);
  });

  it('fails safe on get() when Redis is completely unavailable (connection refused)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

    const result = await cache.get(`oracle:v1:${TEST_PAYER}:100:1`);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[oracle-cache] redis get error'),
      expect.stringContaining('ECONNREFUSED')
    );
    // Ensure payer in key is redacted in warning
    expect(warnSpy.mock.calls[0].join(' ')).not.toContain(TEST_PAYER);
    warnSpy.mockRestore();
  });

  it('fails safe on set() when Redis throws (lost write handled safely)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.set.mockRejectedValueOnce(new Error('READONLY You cannot write against a replica'));

    const response = makeResponse({ trustScore: 88 });
    // set() must resolve without throwing, preventing crash of the calling request
    await expect(cache.set(`oracle:v1:${TEST_PAYER}:100:1`, response, 60)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[oracle-cache] redis set error'),
      expect.stringContaining('READONLY')
    );
    warnSpy.mockRestore();
  });

  it('fails safe on getStale() when Redis throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.get.mockRejectedValueOnce(new Error('Command timed out'));

    const result = await cache.getStale(`oracle:v1:${TEST_PAYER}:100:1`);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('fails safe on invalidateByPrefix() when Redis throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.scan.mockRejectedValueOnce(new Error('Cluster node unreachable'));

    const removed = await cache.invalidateByPrefix('oracle:v1:');
    expect(removed).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('Redis cache failover: lost writes (#1484)', () => {
  it('does not corrupt state or cause subsequent read to return partial data when write is lost', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mock = createMockClient();
    const cache = new RedisOracleCache(mock as unknown as RedisClient);
    const key = `oracle:v1:${TEST_PAYER}:100:1`;

    // First write succeeds
    const resp1 = makeResponse({ trustScore: 70, generatedAt: '2026-04-01T10:00:00.000Z' });
    await cache.set(key, resp1, 60);
    expect((await cache.get(key))?.response.trustScore).toBe(70);

    // Second write fails (e.g. OOM or dropped socket)
    mock.set.mockRejectedValueOnce(new Error('OOM command not allowed when used memory > maxmemory'));
    const resp2 = makeResponse({ trustScore: 90, generatedAt: '2026-04-01T10:05:00.000Z' });
    await cache.set(key, resp2, 60);

    // Prior valid cache state is preserved (or cache can be cleared, but never half-written corrupt JSON)
    const current = await cache.get(key);
    expect(current?.response.trustScore).toBe(70);

    warnSpy.mockRestore();
  });
});

describe('Redis cache failover: split-brain and partitions (#1484)', () => {
  it('rejects stale partition writes in monotonic mode', async () => {
    const mock = createMockClient();
    const cache = new RedisOracleCache({
      client: mock as unknown as RedisClient,
      enforceMonotonicWrites: true,
    });
    const key = `oracle:v1:${TEST_PAYER}:100:1`;

    // Modern publication at 10:10
    const modern = makeResponse({ trustScore: 95, generatedAt: '2026-04-01T10:10:00.000Z' });
    await cache.set(key, modern, 60);

    // Stale delayed publication arriving from a lagging or partitioned node at 10:05
    const stalePartitionVerdict = makeResponse({ trustScore: 50, generatedAt: '2026-04-01T10:05:00.000Z' });
    await cache.set(key, stalePartitionVerdict, 60);

    // Cache must still hold the newer modern publication!
    const current = await cache.get(key);
    expect(current?.response.trustScore).toBe(95);
    expect(current?.generatedAtMs).toBe(Date.parse('2026-04-01T10:10:00.000Z'));
  });

  it('allows newer verdicts to overwrite older verdicts in monotonic mode', async () => {
    const mock = createMockClient();
    const cache = new RedisOracleCache({
      client: mock as unknown as RedisClient,
      enforceMonotonicWrites: true,
    });
    const key = `oracle:v1:${TEST_PAYER}:100:1`;

    const v1 = makeResponse({ trustScore: 60, generatedAt: '2026-04-01T10:00:00.000Z' });
    await cache.set(key, v1, 60);

    const v2 = makeResponse({ trustScore: 99, generatedAt: '2026-04-01T10:15:00.000Z' });
    await cache.set(key, v2, 60);

    const current = await cache.get(key);
    expect(current?.response.trustScore).toBe(99);
  });
});

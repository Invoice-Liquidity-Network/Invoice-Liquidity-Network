import { describe, expect, it, vi } from 'vitest';

import { RpcEndpointPool } from './failover';
import { ValidationError } from './errors';
import type { RpcServerLike } from './types';

function fakeServer(): { server: RpcServerLike; calls: Record<string, number> } {
  const calls: Record<string, number> = { getAccount: 0, simulateTransaction: 0, sendTransaction: 0 };
  const server = {
    getAccount: vi.fn(async () => {
      calls.getAccount += 1;
      return { id: 'GLOBAL' };
    }),
    simulateTransaction: vi.fn(async () => {
      calls.simulateTransaction += 1;
      return { result: { retval: null } };
    }),
    prepareTransaction: vi.fn(async (transaction: unknown) => ({ toXDR: () => 'prepared' })),
    sendTransaction: vi.fn(async () => {
      calls.sendTransaction += 1;
      return { status: 'PENDING', hash: 'hash' };
    }),
    pollTransaction: vi.fn(async () => ({ status: 'SUCCESS' })),
  } as unknown as RpcServerLike;
  return { server, calls };
}

function makePool(
  primary: RpcServerLike,
  secondary: RpcServerLike,
  options: ConstructorParameters<typeof RpcEndpointPool>[1] = {}
): RpcEndpointPool {
  return new RpcEndpointPool(['https://primary.example', 'https://secondary.example'], {
    ...options,
    serverFactory: (url) => (url.startsWith('https://primary') ? primary : secondary),
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RpcEndpointPool', () => {
  it('routes successful calls to the primary endpoint', async () => {
    const primary = fakeServer();
    const secondary = fakeServer();
    const pool = makePool(primary.server, secondary.server);

    expect(await pool.getAccount('GA')).toEqual({ id: 'GLOBAL' });

    expect(primary.calls.getAccount).toBe(1);
    expect(secondary.calls.getAccount).toBe(0);
    expect(pool.getRecommendedUrl()).toMatch(/^https:\/\/primary/);
  });

  it('fails over to the next endpoint on a transient error', async () => {
    const primary = fakeServer();
    const secondary = fakeServer();
    primary.server.simulateTransaction = vi.fn(async () => {
      primary.calls.simulateTransaction += 1;
      throw new Error('fetch failed');
    });
    const pool = makePool(primary.server, secondary.server);

    const result = (await pool.simulateTransaction({})) as { result: { retval: null } };

    expect(result.result.retval).toBeNull();
    expect(primary.calls.simulateTransaction).toBe(1);
    expect(secondary.calls.simulateTransaction).toBe(1);
  });

  it('does NOT fail over on semantic (non-transient) errors', async () => {
    const primary = fakeServer();
    const secondary = fakeServer();
    primary.server.getAccount = vi.fn(async () => {
      primary.calls.getAccount += 1;
      const err = new Error('account not found') as Error & { status: number };
      err.status = 404;
      throw err;
    });
    const pool = makePool(primary.server, secondary.server);

    await expect(pool.getAccount('GUNKNOWN')).rejects.toThrow('account not found');
    expect(secondary.calls.getAccount).toBe(0);
  });

  it('skips a cooled-down primary and prefers it again after cooldown expiry', async () => {
    const primary = fakeServer();
    const secondary = fakeServer();
    primary.server.simulateTransaction = vi.fn(async () => {
      primary.calls.simulateTransaction += 1;
      if (primary.calls.simulateTransaction <= 2) throw new Error('ECONNREFUSED');
      return { result: { retval: 'primary-back' } };
    });
    const pool = makePool(primary.server, secondary.server, {
      failureThreshold: 2,
      cooldownMs: 100,
    });

    await pool.simulateTransaction({});
    await pool.simulateTransaction({});
    await pool.simulateTransaction({}); // primary is cooled down, skipped

    const health = pool.getHealth();
    const primaryHealth = health[0];
    expect(primaryHealth.consecutiveFailures).toBe(2);
    expect(primaryHealth.cooldownUntil).toBeGreaterThan(Date.now());
    expect(primary.calls.simulateTransaction).toBe(2);
    expect(secondary.calls.simulateTransaction).toBe(3);
    expect(pool.getRecommendedUrl()).toBe('https://secondary.example');

    await sleep(130);

    const result = (await pool.simulateTransaction({})) as { result: { retval: string } };
    expect(result.result.retval).toBe('primary-back');
    expect(pool.getRecommendedUrl()).toBe('https://primary.example');
    expect(pool.getHealth()[0].consecutiveFailures).toBe(0);
    expect(primary.calls.simulateTransaction).toBe(3);
    expect(secondary.calls.simulateTransaction).toBe(3);
  });

  it('recovers the primary after cooldown expiry and a successful attempt', async () => {
    const primary = fakeServer();
    const secondary = fakeServer();
    primary.server.simulateTransaction = vi.fn(async () => {
      primary.calls.simulateTransaction += 1;
      if (primary.calls.simulateTransaction <= 2) throw new Error('fetch failed');
      return { result: { retval: 'recovered' } };
    });
    const pool = makePool(primary.server, secondary.server, {
      failureThreshold: 2,
      cooldownMs: 30,
    });

    for (let i = 0; i < 4; i++) {
      await pool.simulateTransaction({});
    }
    expect(pool.getRecommendedUrl()).toBe('https://secondary.example');

    await sleep(60);

    const result = (await pool.simulateTransaction({})) as { result: { retval: string } };
    expect(result.result.retval).toBe('recovered');

    const primaryHealth = pool.getHealth()[0];
    expect(primaryHealth.consecutiveFailures).toBe(0);
    expect(primaryHealth.cooldownUntil).toBe(0);
  });

  it('fails open (attempts endpoints anyway) when every endpoint is cooled down', async () => {
    const primary = fakeServer();
    const secondary = fakeServer();
    const failAll = () => {
      throw new Error('socket hang up');
    };
    primary.server.sendTransaction = vi.fn(async () => {
      primary.calls.sendTransaction += 1;
      failAll();
    });
    secondary.server.sendTransaction = vi.fn(async () => {
      secondary.calls.sendTransaction += 1;
      failAll();
    });
    const pool = makePool(primary.server, secondary.server, { failureThreshold: 1, cooldownMs: 60_000 });

    for (let i = 0; i < 3; i++) {
      await expect(pool.sendTransaction({})).rejects.toThrow('socket hang up');
    }

    // Both endpoints were entered into cooldown, yet the pool still attempted them.
    expect(primary.calls.sendTransaction).toBeGreaterThan(1);
    expect(secondary.calls.sendTransaction).toBeGreaterThan(1);
  });

  it('rejects an empty endpoint list with ValidationError and deduplicates repeated URLs', () => {
    expect(() => new RpcEndpointPool([])).toThrow(ValidationError);

    const pool = new RpcEndpointPool(['https://a.example', 'https://a.example/']);
    expect(pool.getHealth()).toHaveLength(1);
  });

  it('delegates optional getLatestLedger when supported', async () => {
    const primary = fakeServer();
    primary.server.getLatestLedger = vi.fn(async () => ({ sequence: 12345 }));
    const secondary = fakeServer();
    const pool = makePool(primary.server, secondary.server);

    expect(await pool.getLatestLedger()).toEqual({ sequence: 12345 });
  });

  it('reports per-endpoint health through getHealth', async () => {
    const primary = fakeServer();
    const secondary = fakeServer();
    primary.server.getAccount = vi.fn(async () => {
      primary.calls.getAccount += 1;
      throw new Error('fetch failed');
    });
    const pool = makePool(primary.server, secondary.server, { failureThreshold: 1 });

    await pool.getAccount('GX');
    await pool.getAccount('GX');

    const health = pool.getHealth();
    expect(health).toHaveLength(2);
    expect(health[0].url).toMatch(/^https:\/\/primary/);
    expect(health[0].errorEwma).toBeGreaterThan(0);
    expect(health[0].consecutiveFailures).toBe(1);
    expect(health[1].url).toMatch(/^https:\/\/secondary/);
    expect(health[1].attempts).toBe(2);
    expect(pool.getRecommendedUrl()).toBe('https://secondary.example');
  });
});
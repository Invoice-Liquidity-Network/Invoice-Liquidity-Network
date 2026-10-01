import { describe, expect, it, vi } from 'vitest';

import { RpcCircuitBreaker, isCircuitFailure } from './circuit-breaker';
import { RpcCircuitOpenError, ValidationError } from './errors';
import { TimeoutError } from './timeouts';

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

const transient = () =>
  Object.assign(new Error('ECONNRESET socket hang up'), { code: 'ECONNRESET' });

async function fail(breaker: RpcCircuitBreaker, error: unknown = transient()) {
  await expect(breaker.execute(() => Promise.reject(error), 'op')).rejects.toBe(error);
}

describe('RpcCircuitBreaker', () => {
  it('counts transient errors and timeouts as failures but not contract errors', () => {
    expect(isCircuitFailure(transient())).toBe(true);
    expect(isCircuitFailure(new TimeoutError('getAccount', 10))).toBe(true);
    expect(isCircuitFailure({ status: 429 })).toBe(true);
    expect(isCircuitFailure({ status: 503 })).toBe(true);
    expect(isCircuitFailure(new ValidationError('bad input'))).toBe(false);
    expect(isCircuitFailure(new Error('contract returned #7'))).toBe(false);
  });

  it('stays closed below the minimum call volume even at a 100% failure rate', async () => {
    const breaker = new RpcCircuitBreaker({ minimumCalls: 5, now: clock().now });
    for (let i = 0; i < 4; i += 1) await fail(breaker);
    expect(breaker.state).toBe('closed');
  });

  it('opens once the failure ratio over the window reaches the threshold', async () => {
    const onStateChange = vi.fn();
    const breaker = new RpcCircuitBreaker({
      minimumCalls: 4,
      failureRateThreshold: 0.5,
      now: clock().now,
      onStateChange,
    });
    await breaker.execute(() => Promise.resolve('ok'));
    await breaker.execute(() => Promise.resolve('ok'));
    await fail(breaker);
    expect(breaker.state).toBe('closed');
    await fail(breaker); // 2 of 4 failed → 50%
    expect(breaker.state).toBe('open');
    expect(onStateChange).toHaveBeenCalledWith(
      'closed',
      'open',
      expect.objectContaining({ failureRate: 0.5 })
    );
  });

  it('fails fast while open without invoking the operation', async () => {
    const c = clock();
    const breaker = new RpcCircuitBreaker({ minimumCalls: 2, openDurationMs: 30_000, now: c.now });
    await fail(breaker);
    await fail(breaker);
    const fn = vi.fn().mockResolvedValue('never');
    const rejection = breaker.execute(fn, 'simulateTransaction');
    await expect(rejection).rejects.toBeInstanceOf(RpcCircuitOpenError);
    await expect(rejection).rejects.toMatchObject({ code: 'RPC_CIRCUIT_OPEN', retryable: true });
    const error = (await rejection.catch((e) => e)) as RpcCircuitOpenError;
    expect(error.retryAfterMs).toBe(30_000);
    expect(error.message).toContain('simulateTransaction');
    expect(fn).not.toHaveBeenCalled();
  });

  it('lets one trial call through after the open duration and closes on success', async () => {
    const c = clock();
    const breaker = new RpcCircuitBreaker({
      minimumCalls: 2,
      openDurationMs: 1_000,
      halfOpenMaxCalls: 1,
      now: c.now,
    });
    await fail(breaker);
    await fail(breaker);
    c.advance(1_000);
    expect(breaker.state).toBe('half-open');

    let release!: () => void;
    const trial = breaker.execute(
      () => new Promise<string>((resolve) => (release = () => resolve('ok')))
    );
    await expect(breaker.execute(() => Promise.resolve('second'))).rejects.toBeInstanceOf(
      RpcCircuitOpenError
    );
    release();
    await expect(trial).resolves.toBe('ok');
    expect(breaker.state).toBe('closed');
    expect(breaker.snapshot()).toMatchObject({ calls: 0, failures: 0, retryAfterMs: 0 });
  });

  it('re-opens when the half-open trial fails', async () => {
    const c = clock();
    const breaker = new RpcCircuitBreaker({ minimumCalls: 2, openDurationMs: 1_000, now: c.now });
    await fail(breaker);
    await fail(breaker);
    c.advance(1_000);
    await fail(breaker);
    expect(breaker.state).toBe('open');
    expect(breaker.snapshot().retryAfterMs).toBe(1_000);
  });

  it('forgets outcomes that fall outside the sliding window', async () => {
    const c = clock();
    const breaker = new RpcCircuitBreaker({ minimumCalls: 3, windowMs: 10_000, now: c.now });
    await fail(breaker);
    await fail(breaker);
    c.advance(10_001);
    await fail(breaker);
    expect(breaker.state).toBe('closed');
    expect(breaker.snapshot().calls).toBe(1);
  });

  it('ignores non-transient errors for the failure ratio', async () => {
    const breaker = new RpcCircuitBreaker({ minimumCalls: 2, now: clock().now });
    await fail(breaker, new ValidationError('nope'));
    await fail(breaker, new ValidationError('nope'));
    await fail(breaker, new ValidationError('nope'));
    expect(breaker.state).toBe('closed');
    expect(breaker.snapshot().calls).toBe(0);
  });

  it('rejects nonsensical options', () => {
    expect(() => new RpcCircuitBreaker({ failureRateThreshold: 0 })).toThrow(RangeError);
    expect(() => new RpcCircuitBreaker({ failureRateThreshold: 1.5 })).toThrow(RangeError);
    expect(() => new RpcCircuitBreaker({ minimumCalls: 0 })).toThrow(RangeError);
  });

  it('reset() closes the circuit and clears history', async () => {
    const breaker = new RpcCircuitBreaker({ minimumCalls: 2, now: clock().now });
    await fail(breaker);
    await fail(breaker);
    expect(breaker.state).toBe('open');
    breaker.reset();
    expect(breaker.state).toBe('closed');
    await expect(breaker.execute(() => Promise.resolve(1))).resolves.toBe(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withBackoff, computeDelay, isTransientError } from './backoff';

describe('computeDelay', () => {
  const baseOptions = {
    baseDelayMs: 1000,
    maxDelayMs: 10_000,
    multiplier: 2,
    jitter: 0,
  };

  it('returns base delay for attempt 0', () => {
    expect(computeDelay(0, baseOptions)).toBe(1000);
  });

  it('doubles delay with each attempt', () => {
    expect(computeDelay(0, baseOptions)).toBe(1000);
    expect(computeDelay(1, baseOptions)).toBe(2000);
    expect(computeDelay(2, baseOptions)).toBe(4000);
    expect(computeDelay(3, baseOptions)).toBe(8000);
  });

  it('caps delay at maxDelayMs', () => {
    expect(computeDelay(10, baseOptions)).toBe(10_000);
  });

  it('applies jitter when jitter > 0', () => {
    const options = { ...baseOptions, jitter: 0.5 };
    const delays = Array.from({ length: 50 }, () => computeDelay(1, options));

    // With 50% jitter on 2000ms base, delays should vary
    const min = Math.min(...delays);
    const max = Math.max(...delays);
    expect(min).toBeGreaterThanOrEqual(1000); // 2000 - 50% = 1000
    expect(max).toBeLessThanOrEqual(3000); // 2000 + 50% = 3000
  });
});

describe('isTransientError', () => {
  it('returns true for timeout errors', () => {
    expect(isTransientError({ name: 'TimeoutError', message: 'timed out' })).toBe(true);
  });

  it('returns true for HTTP 429', () => {
    expect(isTransientError({ status: 429 })).toBe(true);
  });

  it('returns true for HTTP 502', () => {
    expect(isTransientError({ status: 502 })).toBe(true);
  });

  it('returns true for HTTP 503', () => {
    expect(isTransientError({ status: 503 })).toBe(true);
  });

  it('returns true for HTTP 504', () => {
    expect(isTransientError({ status: 504 })).toBe(true);
  });

  it('returns true for fetch failed errors', () => {
    expect(isTransientError(new Error('fetch failed'))).toBe(true);
  });

  it('returns true for ENOTFOUND errors', () => {
    expect(isTransientError(new Error('getaddrinfo ENOTFOUND'))).toBe(true);
  });

  it('returns true for ECONNREFUSED errors', () => {
    expect(isTransientError(new Error('connect ECONNREFUSED'))).toBe(true);
  });

  it('returns false for non-transient errors', () => {
    expect(isTransientError(new Error('Something went wrong'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTransientError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe('withBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result on first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const promise = withBackoff(fn, { maxRetries: 3, baseDelayMs: 100 });
    const { result, attempts } = await promise;

    expect(result).toBe('success');
    expect(attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient errors and eventually succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue('success');

    const promise = withBackoff(fn, { maxRetries: 3, baseDelayMs: 100, jitter: 0 });

    // Advance past retries
    await vi.advanceTimersByTimeAsync(100); // first retry
    await vi.advanceTimersByTimeAsync(200); // second retry

    const { result, attempts } = await promise;

    expect(result).toBe('success');
    expect(attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fetch failed'));

    const promise = withBackoff(fn, { maxRetries: 2, baseDelayMs: 100, jitter: 0 });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).rejects.toThrow('fetch failed');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('validation failed'));

    await expect(
      withBackoff(fn, { maxRetries: 3, baseDelayMs: 100 })
    ).rejects.toThrow('validation failed');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects custom isRetryable predicate', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });

    const isRetryable = (err: unknown) => (err as any).status === 400;

    const promise = withBackoff(fn, {
      maxRetries: 2,
      baseDelayMs: 100,
      jitter: 0,
      isRetryable,
    });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3); // retries because isRetryable says 400 is retryable
  });

  it('calls onRetry callback before each retry', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue('ok');

    const onRetry = vi.fn();

    const promise = withBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      jitter: 0,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(100);

    const { attempts } = await promise;

    expect(attempts).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 100);
  });

  it('disables retries when maxRetries is 0', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fetch failed'));

    await expect(
      withBackoff(fn, { maxRetries: 0, baseDelayMs: 100 })
    ).rejects.toThrow('fetch failed');

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

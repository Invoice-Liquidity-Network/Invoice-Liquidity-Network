import { describe, it, expect, vi } from 'vitest';
import { isRetryableError, withRetry, CircuitBreaker, CircuitOpenError } from './recovery';
import {
  NetworkError,
  ValidationError,
  WalletNotConnectedError,
  InsufficientBalanceError,
  InvalidDiscountRateError,
  TokenMismatchError,
  PayerReputationTooLowError,
  GenericContractError,
  ILNError,
} from './errors';
import { TimeoutError } from './timeouts';

describe('isRetryableError', () => {
  it('retries NetworkError', () => {
    expect(isRetryableError(new NetworkError())).toBe(true);
  });

  it('retries TimeoutError', () => {
    expect(isRetryableError(new TimeoutError('op', 5000))).toBe(true);
  });

  it('retries ILNError with SIMULATION_FAILED code', () => {
    const simulationErr = new ILNError('simulation failed', 'SIMULATION_FAILED', 'retry');
    expect(isRetryableError(simulationErr)).toBe(true);
  });

  it('does not retry ValidationError', () => {
    expect(isRetryableError(new ValidationError())).toBe(false);
  });

  it('does not retry WalletNotConnectedError', () => {
    expect(isRetryableError(new WalletNotConnectedError())).toBe(false);
  });

  it('does not retry InsufficientBalanceError', () => {
    expect(isRetryableError(new InsufficientBalanceError())).toBe(false);
  });

  it('does not retry InvalidDiscountRateError', () => {
    expect(isRetryableError(new InvalidDiscountRateError())).toBe(false);
  });

  it('does not retry TokenMismatchError', () => {
    expect(isRetryableError(new TokenMismatchError())).toBe(false);
  });

  it('does not retry PayerReputationTooLowError', () => {
    expect(isRetryableError(new PayerReputationTooLowError())).toBe(false);
  });

  it('does not retry GenericContractError', () => {
    expect(isRetryableError(new GenericContractError('raw xdr'))).toBe(false);
  });

  it('does not retry unrecognized ILNError subclasses', () => {
    class CustomILNError extends ILNError {
      constructor() {
        super('custom', 'CUSTOM', 'fix it');
        Object.setPrototypeOf(this, new.target.prototype);
      }
    }
    expect(isRetryableError(new CustomILNError())).toBe(false);
  });

  it('retries unknown non-ILN errors', () => {
    expect(isRetryableError(new Error('unexpected'))).toBe(true);
    expect(isRetryableError('string error')).toBe(true);
    expect(isRetryableError(null)).toBe(true);
  });
});

describe('withRetry', () => {
  // Use initialDelayMs: 0 so retries resolve immediately without fake timers

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new NetworkError()).mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 0,
      jitter: false,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new ValidationError('bad input'));

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 0, jitter: false })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting maxAttempts on retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new NetworkError());

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 0, jitter: false })
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom retryIf — always retry', async () => {
    const fn = vi.fn().mockRejectedValue(new ValidationError());

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 0,
        jitter: false,
        retryIf: () => true,
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom retryIf — never retry', async () => {
    const fn = vi.fn().mockRejectedValue(new NetworkError());

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 0,
        jitter: false,
        retryIf: () => false,
      })
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('CircuitBreaker', () => {
  it('starts CLOSED', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('transitions CLOSED → OPEN after failureThreshold failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    const fn = vi.fn().mockRejectedValue(new NetworkError());

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fn)).rejects.toBeInstanceOf(NetworkError);
    }

    expect(cb.getState()).toBe('OPEN');
  });

  it('resets failure count on success in CLOSED state', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    const failFn = vi.fn().mockRejectedValue(new NetworkError());
    const succFn = vi.fn().mockResolvedValue('ok');

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    await cb.execute(succFn); // resets failure count

    // Two more failures needed to trip (not just 1)
    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('throws CircuitOpenError when OPEN and cooldown not elapsed', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    const fn = vi.fn().mockRejectedValue(new NetworkError());

    await expect(cb.execute(fn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('OPEN');

    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('transitions OPEN → HALF_OPEN after cooldown elapsed', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      successThreshold: 10,
    });
    const failFn = vi.fn().mockRejectedValue(new NetworkError());

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('OPEN');

    vi.advanceTimersByTime(1001);

    const succFn = vi.fn().mockResolvedValue('ok');
    await cb.execute(succFn); // enters HALF_OPEN and records 1 success
    expect(cb.getState()).toBe('HALF_OPEN');

    vi.useRealTimers();
  });

  it('transitions HALF_OPEN → CLOSED after successThreshold successes', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      successThreshold: 2,
    });
    const failFn = vi.fn().mockRejectedValue(new NetworkError());
    const succFn = vi.fn().mockResolvedValue('ok');

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    vi.advanceTimersByTime(1001);

    await cb.execute(succFn); // 1st success in HALF_OPEN
    await cb.execute(succFn); // 2nd success → CLOSED
    expect(cb.getState()).toBe('CLOSED');

    vi.useRealTimers();
  });

  it('transitions HALF_OPEN → OPEN on any failure', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      successThreshold: 2,
    });
    const failFn = vi.fn().mockRejectedValue(new NetworkError());

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    vi.advanceTimersByTime(1001);

    // probe fails in HALF_OPEN → back to OPEN
    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('OPEN');

    // Cooldown resets — immediate retry is blocked
    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(CircuitOpenError);

    vi.useRealTimers();
  });

  it('reset() returns to CLOSED and clears counters', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    const fn = vi.fn().mockRejectedValue(new NetworkError());

    await expect(cb.execute(fn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('OPEN');

    cb.reset();
    expect(cb.getState()).toBe('CLOSED');

    const succFn = vi.fn().mockResolvedValue('ok');
    await expect(cb.execute(succFn)).resolves.toBe('ok');
  });

  it('CircuitOpenError has correct code', () => {
    const err = new CircuitOpenError();
    expect(err.code).toBe('CIRCUIT_OPEN');
    expect(err).toBeInstanceOf(ILNError);
  });
});

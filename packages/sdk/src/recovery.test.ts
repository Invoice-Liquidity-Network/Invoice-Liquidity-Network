import {
  isRetryableError,
  withRetry,
  CircuitBreaker,
  CircuitOpenError,
} from './recovery';
import {
  ILNError,
  NetworkError,
  TimeoutError,
  RateLimitError,
  SimulationError,
  ValidationError,
  WalletNotConnectedError,
  InsufficientBalanceError,
  InvalidDiscountRateError,
  TokenMismatchError,
  PayerReputationTooLowError,
  GenericContractError,
  InvoiceNotFoundError,
  InvoiceAlreadyFundedError,
  InvoiceAlreadyPaidError,
  InvoiceNotFundedError,
  InvoiceDefaultedError,
  InvoiceExpiredError,
  FundingAmountExceededError,
  UnauthorizedError,
  TransactionFailedError,
  XDRParseError,
  InvalidAddressError,
} from './errors';

describe('isRetryableError', () => {
  it('retries NetworkError', () => {
    expect(isRetryableError(new NetworkError())).toBe(true);
  });

  it('retries TimeoutError', () => {
    expect(isRetryableError(new TimeoutError('op'))).toBe(true);
  });

  it('retries RateLimitError', () => {
    expect(isRetryableError(new RateLimitError())).toBe(true);
  });

  it('retries SimulationError', () => {
    expect(isRetryableError(new SimulationError())).toBe(true);
  });

  it('retries ILNError with SIMULATION_FAILED code', () => {
    const simErr = new ILNError('simulation failed', 'SIMULATION_FAILED', 'retry');
    expect(isRetryableError(simErr)).toBe(true);
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

  it('does not retry InvoiceNotFoundError', () => {
    expect(isRetryableError(new InvoiceNotFoundError(1))).toBe(false);
  });

  it('does not retry InvoiceAlreadyFundedError', () => {
    expect(isRetryableError(new InvoiceAlreadyFundedError(1))).toBe(false);
  });

  it('does not retry InvoiceAlreadyPaidError', () => {
    expect(isRetryableError(new InvoiceAlreadyPaidError(1))).toBe(false);
  });

  it('does not retry InvoiceNotFundedError', () => {
    expect(isRetryableError(new InvoiceNotFundedError(1))).toBe(false);
  });

  it('does not retry InvoiceDefaultedError', () => {
    expect(isRetryableError(new InvoiceDefaultedError(1))).toBe(false);
  });

  it('does not retry InvoiceExpiredError', () => {
    expect(isRetryableError(new InvoiceExpiredError(1))).toBe(false);
  });

  it('does not retry FundingAmountExceededError', () => {
    expect(isRetryableError(new FundingAmountExceededError())).toBe(false);
  });

  it('does not retry UnauthorizedError', () => {
    expect(isRetryableError(new UnauthorizedError())).toBe(false);
  });

  it('does not retry TransactionFailedError', () => {
    expect(isRetryableError(new TransactionFailedError())).toBe(false);
  });

  it('does not retry XDRParseError', () => {
    expect(isRetryableError(new XDRParseError())).toBe(false);
  });

  it('does not retry InvalidAddressError', () => {
    expect(isRetryableError(new InvalidAddressError())).toBe(false);
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
  it('returns result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 0,
      jitter: false,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error', async () => {
    const fn = jest.fn().mockRejectedValue(new ValidationError('bad input'));

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 0, jitter: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting maxAttempts on retryable error', async () => {
    const fn = jest.fn().mockRejectedValue(new NetworkError());

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 0, jitter: false }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom retryIf — always retry', async () => {
    const fn = jest.fn().mockRejectedValue(new ValidationError());

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 0,
        jitter: false,
        retryIf: () => true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom retryIf — never retry', async () => {
    const fn = jest.fn().mockRejectedValue(new NetworkError());

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 0,
        jitter: false,
        retryIf: () => false,
      }),
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
    const fn = jest.fn().mockRejectedValue(new NetworkError());

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fn)).rejects.toBeInstanceOf(NetworkError);
    }

    expect(cb.getState()).toBe('OPEN');
  });

  it('resets failure count on success in CLOSED state', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    const failFn = jest.fn().mockRejectedValue(new NetworkError());
    const succFn = jest.fn().mockResolvedValue('ok');

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    await cb.execute(succFn); // resets failure count

    // Two more failures needed to trip (not just 1)
    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('throws CircuitOpenError when OPEN and cooldown not elapsed', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    const fn = jest.fn().mockRejectedValue(new NetworkError());

    await expect(cb.execute(fn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('OPEN');

    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('transitions OPEN → HALF_OPEN after cooldown elapsed', async () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      successThreshold: 10,
    });
    const failFn = jest.fn().mockRejectedValue(new NetworkError());

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('OPEN');

    jest.advanceTimersByTime(1001);

    const succFn = jest.fn().mockResolvedValue('ok');
    await cb.execute(succFn);
    expect(cb.getState()).toBe('HALF_OPEN');

    jest.useRealTimers();
  });

  it('transitions HALF_OPEN → CLOSED after successThreshold successes', async () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      successThreshold: 2,
    });
    const failFn = jest.fn().mockRejectedValue(new NetworkError());
    const succFn = jest.fn().mockResolvedValue('ok');

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    jest.advanceTimersByTime(1001);

    await cb.execute(succFn);
    await cb.execute(succFn);
    expect(cb.getState()).toBe('CLOSED');

    jest.useRealTimers();
  });

  it('transitions HALF_OPEN → OPEN on any failure', async () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      successThreshold: 2,
    });
    const failFn = jest.fn().mockRejectedValue(new NetworkError());

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    jest.advanceTimersByTime(1001);

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('OPEN');

    await expect(cb.execute(failFn)).rejects.toBeInstanceOf(CircuitOpenError);

    jest.useRealTimers();
  });

  it('reset() returns to CLOSED and clears counters', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    const fn = jest.fn().mockRejectedValue(new NetworkError());

    await expect(cb.execute(fn)).rejects.toBeInstanceOf(NetworkError);
    expect(cb.getState()).toBe('OPEN');

    cb.reset();
    expect(cb.getState()).toBe('CLOSED');

    const succFn = jest.fn().mockResolvedValue('ok');
    await expect(cb.execute(succFn)).resolves.toBe('ok');
  });

  it('CircuitOpenError has correct code', () => {
    const err = new CircuitOpenError();
    expect(err.code).toBe('CIRCUIT_OPEN');
    expect(err).toBeInstanceOf(ILNError);
  });
});

import { createLogger } from './logger';
import {
  ILNError,
  NetworkError,
  ValidationError,
  WalletNotConnectedError,
  InsufficientBalanceError,
  InvalidDiscountRateError,
  TokenMismatchError,
  PayerReputationTooLowError,
  GenericContractError,
} from './errors';
import { TimeoutError } from './timeouts';

const logger = createLogger('recovery');

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitter: boolean;
  retryIf?: (err: unknown) => boolean;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  cooldownMs: number;
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  backoffFactor: 2,
  jitter: true,
};

const DEFAULT_CIRCUIT_BREAKER: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  successThreshold: 2,
  cooldownMs: 60_000,
};

export function isRetryableError(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof TimeoutError) return true;
  // SimulationError (code "SIMULATION_FAILED") is retryable — check by code
  // since the compiled JS output may be stale and missing this class.
  if (err instanceof ILNError && err.code === 'SIMULATION_FAILED') return true;
  // All other known ILN business/contract errors are non-retryable by default.
  // Callers can override per-operation via RetryOptions.retryIf.
  if (err instanceof ValidationError) return false;
  if (err instanceof WalletNotConnectedError) return false;
  if (err instanceof InsufficientBalanceError) return false;
  if (err instanceof InvalidDiscountRateError) return false;
  if (err instanceof TokenMismatchError) return false;
  if (err instanceof PayerReputationTooLowError) return false;
  if (err instanceof GenericContractError) return false;
  if (err instanceof ILNError) return false;
  // Non-ILN errors (raw fetch failures, runtime errors) are assumed transient.
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY, ...options };
  const shouldRetry = opts.retryIf ?? isRetryableError;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === opts.maxAttempts) throw err;
      if (!shouldRetry(err)) throw err;

      let delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt - 1),
        opts.maxDelayMs
      );
      if (opts.jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }

      logger(`retry ${attempt}/${opts.maxAttempts - 1} after ${Math.round(delay)}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });

      await sleep(delay);
    }
  }

  throw new Error('withRetry: unexpected exit');
}

export class CircuitOpenError extends ILNError {
  constructor() {
    super(
      'Circuit breaker is open; requests are temporarily blocked.',
      'CIRCUIT_OPEN',
      'Wait for the cooldown period to elapse, then retry your request.'
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private openedAt: number | null = null;
  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULT_CIRCUIT_BREAKER, ...options };
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = null;
    logger('circuit breaker reset to CLOSED');
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed < this.options.cooldownMs) {
        throw new CircuitOpenError();
      }
      this.state = 'HALF_OPEN';
      this.successCount = 0;
      logger('circuit breaker → HALF_OPEN');
    }

    try {
      const result = await fn();

      if (this.state === 'HALF_OPEN') {
        this.successCount++;
        if (this.successCount >= this.options.successThreshold) {
          this.state = 'CLOSED';
          this.failureCount = 0;
          this.successCount = 0;
          this.openedAt = null;
          logger('circuit breaker → CLOSED');
        }
      } else {
        this.failureCount = 0;
      }

      return result;
    } catch (err) {
      if (this.state === 'HALF_OPEN') {
        this.state = 'OPEN';
        this.openedAt = Date.now();
        this.successCount = 0;
        logger('circuit breaker → OPEN (from HALF_OPEN)');
      } else {
        this.failureCount++;
        if (this.failureCount >= this.options.failureThreshold) {
          this.state = 'OPEN';
          this.openedAt = Date.now();
          this.failureCount = 0;
          logger('circuit breaker → OPEN');
        }
      }
      throw err;
    }
  }
}

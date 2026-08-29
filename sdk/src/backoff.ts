/**
 * Exponential backoff and retry utilities for SDK RPC calls.
 *
 * Provides configurable retry logic with exponential backoff to prevent
 * accidental self-DoS when hammering RPC endpoints, especially in retry
 * loops around transient failures.
 */

export interface BackoffOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Initial delay in milliseconds before the first retry (default: 500). */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds between retries (default: 10_000). */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each retry (default: 2). */
  multiplier?: number;
  /** Optional jitter range 0–1 to randomize delays (default: 0.25). */
  jitter?: number;
  /** Optional predicate to decide if the error is retryable. Defaults to true for network/5xx errors. */
  isRetryable?: (error: unknown) => boolean;
  /** Optional callback invoked before each retry. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

export interface BackoffResult<T> {
  result: T;
  attempts: number;
}

/**
 * Compute delay in milliseconds for a given retry attempt using
 * exponential backoff with optional jitter.
 */
export function computeDelay(attempt: number, options: Required<Omit<BackoffOptions, 'isRetryable' | 'onRetry'>>): number {
  const exponentialDelay = options.baseDelayMs * Math.pow(options.multiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  if (options.jitter > 0) {
    const jitterRange = cappedDelay * options.jitter;
    return cappedDelay - jitterRange + Math.random() * jitterRange * 2;
  }

  return cappedDelay;
}

/**
 * Determine if an error is likely transient and worth retrying.
 * Checks for common network errors, HTTP 429 (rate limit), and 5xx status codes.
 */
export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  const err = error as Record<string, unknown>;

  // Timeout errors are always retryable
  if (err.name === 'TimeoutError' || err.message?.toString().includes('timed out')) {
    return true;
  }

  // HTTP 429 (Too Many Requests) — rate limited
  if (err.status === 429 || err.statusCode === 429) {
    return true;
  }

  // HTTP 5xx server errors
  if (typeof err.status === 'number' && err.status >= 500 && err.status < 600) {
    return true;
  }
  if (typeof err.statusCode === 'number' && err.statusCode >= 500 && err.statusCode < 600) {
    return true;
  }

  // Common network error patterns
  const msg = String(err.message ?? err.toString() ?? '').toLowerCase();
  const transientPatterns = [
    'fetch failed',
    'networkerror',
    'enotfound',
    'econnrefused',
    'econnreset',
    'econnaborted',
    'socket hang up',
    'request failed',
    'network request failed',
    '502',
    '503',
    '504',
  ];

  if (transientPatterns.some((pattern) => msg.includes(pattern))) {
    return true;
  }

  return false;
}

/**
 * Execute an async operation with exponential backoff retry.
 *
 * @param fn - The async function to execute.
 * @param options - Backoff configuration options.
 * @returns The result of the operation along with attempt count.
 *
 * @example
 * ```ts
 * const { result } = await withBackoff(
 *   () => server.getAccount(address),
 *   { maxRetries: 3, baseDelayMs: 500 }
 * );
 * ```
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {}
): Promise<BackoffResult<T>> {
  const config: Required<Omit<BackoffOptions, 'isRetryable' | 'onRetry'>> & Pick<BackoffOptions, 'isRetryable' | 'onRetry'> = {
    maxRetries: options.maxRetries ?? 3,
    baseDelayMs: options.baseDelayMs ?? 500,
    maxDelayMs: options.maxDelayMs ?? 10_000,
    multiplier: options.multiplier ?? 2,
    jitter: options.jitter ?? 0.25,
    isRetryable: options.isRetryable,
    onRetry: options.onRetry,
  };

  const retryableCheck = config.isRetryable ?? isTransientError;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;

      if (attempt >= config.maxRetries || !retryableCheck(error)) {
        throw error;
      }

      const delayMs = computeDelay(attempt, config);

      if (config.onRetry) {
        config.onRetry(attempt + 1, error, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

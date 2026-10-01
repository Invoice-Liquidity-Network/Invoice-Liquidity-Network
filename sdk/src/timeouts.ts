/** Default timeout for general SDK requests (30 seconds). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Default timeout for read-only RPC calls (10 seconds). */
export const DEFAULT_READ_TIMEOUT_MS = 10_000;
/** Default timeout for write RPC calls (30 seconds). */
export const DEFAULT_WRITE_TIMEOUT_MS = 30_000;
/** Default timeout for simulation RPC calls (15 seconds). */
export const DEFAULT_SIMULATION_TIMEOUT_MS = 15_000;

/**
 * Per-operation timeout configuration in milliseconds.
 */
export interface RequestTimeouts {
  /** Timeout for read-only operations (e.g. getInvoice, getStats). */
  readMs: number;
  /** Timeout for write operations (e.g. submitInvoice, fundInvoice). */
  writeMs: number;
  /** Timeout for transaction simulations. */
  simulationMs: number;
}

/**
 * Resolve request timeouts from SDK configuration.
 * Falls back to defaults when specific timeouts are not provided.
 *
 * @param config - SDK configuration with optional timeout overrides.
 * @returns Resolved timeout values for each operation type.
 */
export function resolveRequestTimeouts(config: {
  timeoutMs?: number;
  timeouts?: Partial<RequestTimeouts>;
}): RequestTimeouts {
  return {
    readMs: config.timeouts?.readMs ?? config.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    writeMs: config.timeouts?.writeMs ?? config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    simulationMs:
      config.timeouts?.simulationMs ?? config.timeoutMs ?? DEFAULT_SIMULATION_TIMEOUT_MS,
  };
}

/**
 * Execute a promise with a timeout. Rejects with a TimeoutError if the
 * promise doesn't resolve within the specified duration.
 *
 * @param operation - Name of the operation (used in error messages).
 * @param timeoutMs - Maximum time to wait in milliseconds.
 * @param promise - The promise to execute with a timeout.
 * @returns The result of the promise if it resolves within the timeout.
 * @throws {TimeoutError} If the promise doesn't resolve within the timeout.
 *
 * @example
 * ```ts
 * const result = await withTimeout("getAccount", 10000, server.getAccount(addr));
 * ```
 */
export async function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  promise: Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Error thrown when an SDK operation exceeds its timeout limit.
 *
 * @property operation - The name of the operation that timed out.
 * @property timeoutMs - The timeout duration in milliseconds.
 */
export class TimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms.`);
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

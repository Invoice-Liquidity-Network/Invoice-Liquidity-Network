/**
 * Structured error types for the notifications service.
 *
 * Follows the same ILNError conventions as the SDK (`sdk/src/errors.ts`)
 * to ensure consistent error codes, remediation guidance, and retryability
 * across all backend services in the monorepo.
 */

const DEFAULT_DOCS_BASE_URL =
  'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/errors.md';

function withDocs(code: string): string {
  return `${DEFAULT_DOCS_BASE_URL}#${code.toLowerCase()}`;
}

/**
 * Base error class for all notifications service errors.
 */
export class ILNError extends Error {
  public code: string;
  public remediation: string;
  public docsUrl?: string;
  public context?: Record<string, unknown>;
  public retryable?: boolean;
  public cause?: unknown;

  constructor(
    message: string,
    code: string,
    remediation: string,
    options?: {
      docsUrl?: string;
      context?: Record<string, unknown>;
      retryable?: boolean;
      cause?: unknown;
    }
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
    this.code = code;
    this.remediation = remediation;

    if (options?.docsUrl) this.docsUrl = options.docsUrl;
    if (options?.context) this.context = options.context;
    if (typeof options?.retryable === 'boolean') this.retryable = options.retryable;
    if (options && 'cause' in options) this.cause = options.cause;
  }
}

/**
 * Thrown when a network request to the RPC server fails.
 */
export class NetworkError extends ILNError {
  constructor(message = 'Network request failed.', context?: Record<string, unknown>) {
    super(
      message,
      'NETWORK_ERROR',
      'Failed to reach the Stellar RPC endpoint. Verify the rpcUrl, check connectivity, and ensure the RPC server is healthy.',
      {
        docsUrl: withDocs('NETWORK_ERROR'),
        context,
        retryable: true,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a network request times out.
 */
export class TimeoutError extends ILNError {
  constructor(
    operation = 'unknown operation',
    timeoutMs?: number,
    context?: Record<string, unknown>
  ) {
    super(
      `Operation "${operation}" timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}.`,
      'TIMEOUT',
      'The request took too long to complete. Check network connectivity and RPC server load, then retry.',
      {
        docsUrl: withDocs('TIMEOUT'),
        context: { operation, timeoutMs, ...context },
        retryable: true,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when transaction simulation fails.
 */
export class SimulationError extends ILNError {
  constructor(message = 'Transaction simulation failed.', context?: Record<string, unknown>) {
    super(
      message,
      'SIMULATION_FAILED',
      'The SDK could not simulate the transaction successfully. Review transaction parameters and ensure contract state is consistent before retrying.',
      {
        docsUrl: withDocs('SIMULATION_FAILED'),
        context,
        retryable: true,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a contract call fails with a specific error code.
 */
export class ContractCallError extends ILNError {
  constructor(
    message: string,
    public readonly contractId?: string,
    public readonly method?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message,
      'CONTRACT_ERROR',
      'The contract rejected the transaction. Check invoice/operation parameters and inspect on-chain error details.',
      {
        docsUrl: withDocs('CONTRACT_ERROR'),
        context: { contractId, method, ...context },
        retryable: false,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an RPC response is unexpected or malformed.
 */
export class RPCResponseError extends ILNError {
  constructor(message = 'Unexpected RPC response.', context?: Record<string, unknown>) {
    super(
      message,
      'RPC_RESPONSE_ERROR',
      'The RPC server returned an unexpected response. Check for API version mismatches or server-side issues.',
      {
        docsUrl: withDocs('RPC_RESPONSE_ERROR'),
        context,
        retryable: false,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Error Classification ────────────────────────────────────────────────────

/**
 * Determines whether an error from the RPC layer is transient and worth retrying.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof ILNError) {
    return err.retryable === true;
  }
  // Unknown errors are assumed transient
  return true;
}

/**
 * Normalizes any caught error into a structured ILNError.
 */
export function normalizeError(
  err: unknown,
  fallbackCode = 'UNKNOWN_ERROR',
  fallbackMessage = 'An unexpected error occurred.'
): ILNError {
  if (err instanceof ILNError) {
    return err;
  }

  if (err instanceof Error) {
    // Detect common RPC/network errors by name or message
    const name = err.name.toLowerCase();
    const msg = err.message.toLowerCase();

    if (name === 'timeouterror' || msg.includes('timeout') || msg.includes('timed out')) {
      return new TimeoutError('rpc-call', undefined, { originalMessage: err.message });
    }

    if (
      name === 'fetcherror' ||
      name === 'networkerror' ||
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound')
    ) {
      return new NetworkError(err.message, { originalName: err.name });
    }

    return new ILNError(
      err.message || fallbackMessage,
      fallbackCode,
      'Review the cause and stack trace for details.',
      {
        docsUrl: withDocs(fallbackCode),
        context: { name: err.name, stack: err.stack },
        cause: err,
        retryable: isTransientNetworkError(err),
      }
    );
  }

  if (typeof err === 'string') {
    return new ILNError(err, fallbackCode, 'An unclassified string error.', {
      docsUrl: withDocs(fallbackCode),
      retryable: false,
    });
  }

  return new ILNError(fallbackMessage, fallbackCode, 'An unclassified error object was thrown.', {
    docsUrl: withDocs(fallbackCode),
    context: { raw: err },
    cause: err,
    retryable: false,
  });
}

function isTransientNetworkError(err: Error): boolean {
  const name = err.name.toLowerCase();
  const msg = err.message.toLowerCase();
  return (
    name === 'fetcherror' ||
    name === 'timeouterror' ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound')
  );
}

/** Alias for normalizeError */
export const toILNError = normalizeError;

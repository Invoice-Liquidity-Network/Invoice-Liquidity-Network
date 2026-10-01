/**
 * Base error class for all ILN SDK errors.
 *
 * Provides structured error codes, remediation guidance, documentation links, and context.
 */
export class ILNError extends Error {
  /** Machine-readable error code (e.g. "INSUFFICIENT_BALANCE"). */
  public code: string;
  /** Human-readable suggestion for resolving the error. */
  public remediation: string;
  /** Optional documentation URL for this error code. */
  public docsUrl?: string;
  /** Optional structured debugging context (never include secrets). */
  public context?: Record<string, unknown>;
  /** Whether the operation is likely retryable. */
  public retryable?: boolean;
  /** Preserve original error for debugging. */
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

const DEFAULT_DOCS_BASE_URL =
  'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/errors.md';

function withDocs(code: string): string {
  // Link to an anchor on docs/errors.md for programmatic navigation.
  return `${DEFAULT_DOCS_BASE_URL}#${code.toLowerCase()}`;
}

/**
 * Thrown when the provided discount rate exceeds protocol limits.
 */
export class InvalidDiscountRateError extends ILNError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Invalid discount rate.',
      'INVALID_DISCOUNT_RATE',
      'Check `discountRate` is within protocol bounds (see `getProtocolConfig().maxDiscountRate`). If using basis points, ensure value is in bps (e.g., 300 = 3%).',
      {
        docsUrl: withDocs('INVALID_DISCOUNT_RATE'),
        context,
        retryable: false,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a token mismatch occurs in a transaction.
 */
export class TokenMismatchError extends ILNError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Token mismatch in transaction.',
      'TOKEN_MISMATCH',
      'Verify that the token contract ID/address used matches the token configured for the invoice/protocol.',
      {
        docsUrl: withDocs('TOKEN_MISMATCH'),
        context,
        retryable: false,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the payer\'s reputation score is below the protocol minimum.
 */
export class PayerReputationTooLowError extends ILNError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Payer reputation is too low.',
      'PAYER_REPUTATION_TOO_LOW',
      'The payer does not meet the protocol minimum reputation threshold for this invoice. Check payer score and re-submit with an eligible payer.',
      {
        docsUrl: withDocs('PAYER_REPUTATION_TOO_LOW'),
        context,
        retryable: false,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the account has insufficient balance for a transaction.
 */
export class InsufficientBalanceError extends ILNError {
  constructor(
    message = 'Insufficient balance to complete the transaction.',
    remediation = 'Ensure the account has enough funds (including transaction fees) before retrying. If you are on testnet, fund the account and re-submit.',
    context?: Record<string, unknown>
  ) {
    super(message, 'INSUFFICIENT_BALANCE', remediation, {
      docsUrl: withDocs('INSUFFICIENT_BALANCE'),
      context,
      retryable: true,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a network request to the RPC server fails.
 */
export class NetworkError extends ILNError {
  constructor(
    message = 'Network request failed.',
    remediation = 'Failed to reach the configured Stellar RPC endpoint. Verify your `rpcUrl`, check connectivity, and ensure the RPC server is healthy.',
    context?: Record<string, unknown>
  ) {
    super(message, 'NETWORK_ERROR', remediation, {
      docsUrl: withDocs('NETWORK_ERROR'),
      context,
      retryable: true,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a transaction fails to execute on-chain.
 */
export class TransactionFailedError extends ILNError {
  constructor(
    message = 'Transaction execution failed on-chain.',
    remediation = 'The contract rejected the transaction. Review simulation/tx failure reason, verify invoice state, and confirm fee/resource settings.',
    context?: Record<string, unknown>
  ) {
    super(message, 'TRANSACTION_FAILED', remediation, {
      docsUrl: withDocs('TRANSACTION_FAILED'),
      context,
      retryable: false,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when input validation fails.
 */
export class ValidationError extends ILNError {
  constructor(
    message = 'Validation failed.',
    remediation = 'Check provided input parameters. Use `Validators` to validate fields and inspect which constraint failed.',
    context?: Record<string, unknown>
  ) {
    super(message, 'VALIDATION_ERROR', remediation, {
      docsUrl: withDocs('VALIDATION_ERROR'),
      context,
      retryable: false,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a wallet is required but not connected.
 */
export class WalletNotConnectedError extends ILNError {
  constructor(
    message = 'Wallet is not connected.',
    remediation = 'A transaction signer is required for this state-changing operation. Provide a `signer` in the `ILNSdk` configuration or ensure wallet is connected.',
    context?: Record<string, unknown>
  ) {
    super(message, 'WALLET_NOT_CONNECTED', remediation, {
      docsUrl: withDocs('WALLET_NOT_CONNECTED'),
      context,
      retryable: false,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown for generic contract errors that don\'t match specific error types.
 */
export class GenericContractError extends ILNError {
  constructor(rawError: string, context?: Record<string, unknown>) {
    super(
      `Contract error: ${rawError}`,
      'CONTRACT_ERROR',
      'The contract rejected the transaction. Check invoice/operation parameters and inspect on-chain error details.',
      {
        docsUrl: withDocs('CONTRACT_ERROR'),
        context: {
          rawError,
          ...(context ?? {}),
        },
        retryable: false,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when transaction simulation fails.
 */
export class SimulationError extends ILNError {
  constructor(
    message = 'Transaction simulation failed.',
    remediation = 'The SDK could not simulate the transaction successfully. Review transaction parameters and ensure contract state is consistent before retrying.',
    context?: Record<string, unknown>
  ) {
    super(message, 'SIMULATION_FAILED', remediation, {
      docsUrl: withDocs('SIMULATION_FAILED'),
      context,
      retryable: false,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the prepared transaction XDR differs from the simulated transaction,
 * indicating the RPC node may have tampered with or forged the prepared XDR.
 * This is a security safeguard against compromised RPC nodes per the trust model.
 */
export class SimulationPreparedXdrMismatchError extends ILNError {
  constructor(
    message = 'Prepared transaction differs from simulated transaction.',
    remediation = 'The prepared XDR does not match the original simulated transaction. A compromised RPC node may be forging the prepared XDR. Verify your RPC endpoint integrity and consider using a different node.',
    context?: Record<string, unknown>
  ) {
    super(message, 'SIMULATION_PREPARED_XDR_MISMATCH', remediation, {
      docsUrl: withDocs('SIMULATION_PREPARED_XDR_MISMATCH'),
      context,
      retryable: false,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Parse a raw contract error into a typed ILNError with detailed debugging context.
 *
 * @param xdrError - The raw error value from the contract.
 * @param signature - Optional function signature or operation name.
 * @returns A typed ILNError instance.
 */
export function parseContractError(xdrError: unknown, signature?: string): ILNError {
  const errorStr = typeof xdrError === 'string' ? xdrError : JSON.stringify(xdrError);

  const baseContext: Record<string, unknown> = {
    rawError: xdrError,
    rawErrorString: errorStr,
  };
  if (signature) {
    baseContext.matchedSignature = signature;
  }

  if (errorStr.includes('InvalidDiscountRate')) {
    return new InvalidDiscountRateError({ ...baseContext, matchedPattern: 'InvalidDiscountRate' });
  }
  if (errorStr.includes('TokenMismatch')) {
    return new TokenMismatchError({ ...baseContext, matchedPattern: 'TokenMismatch' });
  }
  if (errorStr.includes('PayerReputationTooLow')) {
    return new PayerReputationTooLowError({
      ...baseContext,
      matchedPattern: 'PayerReputationTooLow',
    });
  }

  return new GenericContractError(errorStr, {
    ...baseContext,
    matchedPattern: 'Unknown',
  });
}

/**
 * Normalizes any caught error or unknown object into a consistent, structured ILNError.
 *
 * @param err - The unknown error thrown by a function or network call.
 * @param fallbackCode - Optional fallback code if err cannot be classified (default: 'UNKNOWN_ERROR').
 * @param fallbackMessage - Optional fallback message if err has no message.
 * @returns A guaranteed ILNError instance with structured code, remediation, and optional context.
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
    return new ILNError(
      err.message || fallbackMessage,
      fallbackCode,
      'Review the cause and stack trace for details. Verify input parameters and endpoint connectivity.',
      {
        docsUrl: withDocs(fallbackCode),
        context: { name: err.name, stack: err.stack },
        cause: err,
        retryable: false,
      }
    );
  }

  if (typeof err === 'string') {
    return parseContractError(err);
  }

  const rawStr = typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err);
  return new ILNError(
    fallbackMessage,
    fallbackCode,
    'An unclassified error object was thrown. Inspect the raw context object for debugging.',
    {
      docsUrl: withDocs(fallbackCode),
      context: { raw: err, rawStr },
      cause: err,
      retryable: false,
    }
  );
}

/** Alias for normalizeError */
export const toILNError = normalizeError;

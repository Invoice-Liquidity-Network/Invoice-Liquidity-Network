/**
 * Structured error classes for the Invoice Liquidity Network SDK.
 *
 * Provides a hierarchy of typed errors with machine-readable codes,
 * remediation guidance, documentation links, and structured context
 * for debugging. All errors extend `ILNError` for consistent handling.
 *
 * @example
 * ```ts
 * import { ILNError, InvoiceNotFoundError, normalizeError } from '@iln/sdk/errors';
 *
 * try {
 *   await client.getInvoice(42);
 * } catch (err) {
 *   const ilnErr = normalizeError(err);
 *   console.error(ilnErr.code, ilnErr.remediation);
 *   if (ilnErr.retryable) await retry();
 * }
 * ```
 */

// ── Base Error ──────────────────────────────────────────────────────────────

const DEFAULT_DOCS_BASE_URL =
  'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/errors.md';

function withDocs(code: string): string {
  return `${DEFAULT_DOCS_BASE_URL}#${code.toLowerCase()}`;
}

/**
 * Base error class for all ILN SDK errors.
 *
 * Provides structured error codes, remediation guidance, documentation links,
 * and optional context for debugging.
 */
export class ILNError extends Error {
  /** Machine-readable error code (e.g. "INVOICE_NOT_FOUND"). */
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
    },
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

// ── Invoice Errors (INVOICE_*) ──────────────────────────────────────────────

/**
 * Thrown when the requested invoice does not exist.
 */
export class InvoiceNotFoundError extends ILNError {
  constructor(invoiceId: number | string, context?: Record<string, unknown>) {
    super(
      `Invoice #${invoiceId} not found.`,
      'INVOICE_NOT_FOUND',
      'Verify the invoice ID is correct and the invoice has been submitted on-chain.',
      {
        docsUrl: withDocs('INVOICE_NOT_FOUND'),
        context: { invoiceId, ...context },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when attempting to fund an already-funded invoice.
 */
export class InvoiceAlreadyFundedError extends ILNError {
  constructor(invoiceId: number | string, context?: Record<string, unknown>) {
    super(
      `Invoice #${invoiceId} has already been funded.`,
      'INVOICE_ALREADY_FUNDED',
      'This invoice already has a funder. Check invoice status before attempting to fund.',
      {
        docsUrl: withDocs('INVOICE_ALREADY_FUNDED'),
        context: { invoiceId, ...context },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when attempting to pay an already-paid invoice.
 */
export class InvoiceAlreadyPaidError extends ILNError {
  constructor(invoiceId: number | string, context?: Record<string, unknown>) {
    super(
      `Invoice #${invoiceId} has already been paid.`,
      'INVOICE_ALREADY_PAID',
      'This invoice has already been settled. No further payment action is needed.',
      {
        docsUrl: withDocs('INVOICE_ALREADY_PAID'),
        context: { invoiceId, ...context },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when attempting to operate on an invoice that is not yet funded.
 */
export class InvoiceNotFundedError extends ILNError {
  constructor(invoiceId: number | string, context?: Record<string, unknown>) {
    super(
      `Invoice #${invoiceId} is not yet funded.`,
      'INVOICE_NOT_FUNDED',
      'This operation requires the invoice to be funded first. Wait for a funder or check invoice status.',
      {
        docsUrl: withDocs('INVOICE_NOT_FUNDED'),
        context: { invoiceId, ...context },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an invoice has defaulted.
 */
export class InvoiceDefaultedError extends ILNError {
  constructor(invoiceId: number | string, context?: Record<string, unknown>) {
    super(
      `Invoice #${invoiceId} has defaulted.`,
      'INVOICE_DEFAULTED',
      'This invoice has been marked as defaulted. Review default resolution procedures.',
      {
        docsUrl: withDocs('INVOICE_DEFAULTED'),
        context: { invoiceId, ...context },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an invoice has expired.
 */
export class InvoiceExpiredError extends ILNError {
  constructor(invoiceId: number | string, context?: Record<string, unknown>) {
    super(
      `Invoice #${invoiceId} has expired.`,
      'INVOICE_EXPIRED',
      'This invoice is past its expiry date and can no longer be funded or processed.',
      {
        docsUrl: withDocs('INVOICE_EXPIRED'),
        context: { invoiceId, ...context },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Funding Errors (FUNDING_*) ──────────────────────────────────────────────

/**
 * Thrown when the funding amount exceeds the remaining invoice balance.
 */
export class FundingAmountExceededError extends ILNError {
  constructor(
    message = 'Funding amount exceeds the remaining balance.',
    context?: Record<string, unknown>,
  ) {
    super(
      message,
      'FUNDING_AMOUNT_EXCEEDED',
      'The requested funding amount is larger than the unfunded portion of the invoice. Reduce the amount or check the remaining balance.',
      {
        docsUrl: withDocs('FUNDING_AMOUNT_EXCEEDED'),
        context,
        retryable: false,
      },
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
    remediation = 'Ensure the account has enough funds (including transaction fees) before retrying. If on testnet, fund the account first.',
    context?: Record<string, unknown>,
  ) {
    super(message, 'INSUFFICIENT_BALANCE', remediation, {
      docsUrl: withDocs('INSUFFICIENT_BALANCE'),
      context,
      retryable: true,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Network Errors (NETWORK_*) ──────────────────────────────────────────────

/**
 * Thrown when a network request to Horizon or Soroban RPC fails.
 */
export class NetworkError extends ILNError {
  constructor(
    message = 'Network request failed.',
    remediation = 'Failed to reach the Stellar RPC endpoint. Verify the rpcUrl, check connectivity, and ensure the RPC server is healthy.',
    context?: Record<string, unknown>,
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
 * Thrown when a network request times out.
 */
export class TimeoutError extends ILNError {
  constructor(
    operation = 'unknown operation',
    timeoutMs?: number,
    context?: Record<string, unknown>,
  ) {
    super(
      `Operation "${operation}" timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}.`,
      'TIMEOUT',
      'The request took too long to complete. Check network connectivity and RPC server load, then retry.',
      {
        docsUrl: withDocs('TIMEOUT'),
        context: { operation, timeoutMs, ...context },
        retryable: true,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Auth Errors (AUTH_*) ────────────────────────────────────────────────────

/**
 * Thrown when the user is unauthorized for the requested operation.
 */
export class UnauthorizedError extends ILNError {
  constructor(
    operation?: string,
    context?: Record<string, unknown>,
  ) {
    super(
      operation
        ? `Unauthorized for operation "${operation}".`
        : 'Unauthorized for this operation.',
      'UNAUTHORIZED',
      'You do not have permission to perform this action. Verify you are using the correct wallet/signer for this operation.',
      {
        docsUrl: withDocs('UNAUTHORIZED'),
        context: { operation, ...context },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a wallet is required but not connected.
 */
export class WalletNotConnectedError extends ILNError {
  constructor(
    message = 'Wallet is not connected.',
    context?: Record<string, unknown>,
  ) {
    super(
      message,
      'WALLET_NOT_CONNECTED',
      'A transaction signer is required for this state-changing operation. Connect a wallet or provide a signer.',
      {
        docsUrl: withDocs('WALLET_NOT_CONNECTED'),
        context,
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Token Errors (TOKEN_*) ──────────────────────────────────────────────────

/**
 * Thrown when a token mismatch occurs in a transaction.
 */
export class TokenMismatchError extends ILNError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Token mismatch in transaction.',
      'TOKEN_MISMATCH',
      'Verify that the token contract ID/address matches the token configured for the invoice/protocol.',
      {
        docsUrl: withDocs('TOKEN_MISMATCH'),
        context,
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Contract Errors (CONTRACT_*) ────────────────────────────────────────────

/**
 * Thrown when the provided discount rate exceeds protocol limits.
 */
export class InvalidDiscountRateError extends ILNError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Invalid discount rate.',
      'INVALID_DISCOUNT_RATE',
      'Check that discountRate is within protocol bounds. If using basis points, ensure value is in bps (e.g., 300 = 3%).',
      {
        docsUrl: withDocs('INVALID_DISCOUNT_RATE'),
        context,
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the payer's reputation score is below the protocol minimum.
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
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a Soroban contract simulation or invocation fails.
 */
export class ContractCallError extends ILNError {
  constructor(
    message: string,
    public readonly contractId?: string,
    public readonly method?: string,
    context?: Record<string, unknown>,
  ) {
    super(
      message,
      'CONTRACT_ERROR',
      'The contract rejected the transaction. Check invoice/operation parameters and inspect on-chain error details.',
      {
        docsUrl: withDocs('CONTRACT_ERROR'),
        context: { contractId, method, ...context },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown for generic contract errors that don't match specific error types.
 */
export class GenericContractError extends ILNError {
  constructor(rawError: string, context?: Record<string, unknown>) {
    super(
      `Contract error: ${rawError}`,
      'CONTRACT_ERROR',
      'The contract rejected the transaction. Check invoice/operation parameters and inspect on-chain error details.',
      {
        docsUrl: withDocs('CONTRACT_ERROR'),
        context: { rawError, ...(context ?? {}) },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Transaction / Simulation Errors ─────────────────────────────────────────

/**
 * Thrown when a transaction fails to execute on-chain.
 */
export class TransactionFailedError extends ILNError {
  constructor(
    message = 'Transaction execution failed on-chain.',
    context?: Record<string, unknown>,
  ) {
    super(
      message,
      'TRANSACTION_FAILED',
      'The contract rejected the transaction. Review simulation/tx failure reason, verify invoice state, and confirm fee/resource settings.',
      {
        docsUrl: withDocs('TRANSACTION_FAILED'),
        context,
        retryable: false,
      },
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
    context?: Record<string, unknown>,
  ) {
    super(
      message,
      'SIMULATION_FAILED',
      'The SDK could not simulate the transaction successfully. Review transaction parameters and ensure contract state is consistent before retrying.',
      {
        docsUrl: withDocs('SIMULATION_FAILED'),
        context,
        retryable: true,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when input validation fails.
 */
export class ValidationError extends ILNError {
  constructor(
    message = 'Validation failed.',
    remediation = 'Check provided input parameters. Use the Validators to validate fields and inspect which constraint failed.',
    context?: Record<string, unknown>,
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
 * Thrown when XDR parsing or decoding fails.
 */
export class XDRParseError extends ILNError {
  constructor(
    message = 'XDR parsing failed.',
    context?: Record<string, unknown>,
  ) {
    super(
      message,
      'XDR_PARSE_ERROR',
      'The XDR data could not be parsed. Ensure the XDR is well-formed and matches the expected format.',
      {
        docsUrl: withDocs('XDR_PARSE_ERROR'),
        context,
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an invalid Stellar address is provided.
 */
export class InvalidAddressError extends ILNError {
  constructor(
    message = 'Invalid Stellar address.',
    public readonly address?: string,
    context?: Record<string, unknown>,
  ) {
    super(
      message,
      'INVALID_ADDRESS',
      'Provide a valid Stellar address starting with G (account) or C (contract).',
      {
        docsUrl: withDocs('INVALID_ADDRESS'),
        context: { address, ...context },
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Rate Limit Errors ───────────────────────────────────────────────────────

/**
 * Thrown when a rate limit is exceeded (e.g. RPC throttling).
 */
export class RateLimitError extends ILNError {
  constructor(
    message = 'Rate limit exceeded.',
    retryAfterMs?: number,
    context?: Record<string, unknown>,
  ) {
    super(
      message,
      'RATE_LIMITED',
      'Too many requests. Wait before retrying, or reduce request frequency.',
      {
        docsUrl: withDocs('RATE_LIMITED'),
        context: { retryAfterMs, ...context },
        retryable: true,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Parsing Utilities ───────────────────────────────────────────────────────

/**
 * Contract error code to error class mapping, derived from errors.rs patterns.
 * Maps numeric Soroban error codes to their string names and ILNError classes.
 */
const CONTRACT_ERROR_MAP: Record<number, { name: string; Ctor: typeof ILNError }> = {
  1: { name: 'InvoiceNotFound', Ctor: InvoiceNotFoundError },
  2: { name: 'InvoiceAlreadyFunded', Ctor: InvoiceAlreadyFundedError },
  3: { name: 'InvoiceAlreadyPaid', Ctor: InvoiceAlreadyPaidError },
  4: { name: 'InvoiceNotFunded', Ctor: InvoiceNotFundedError },
  5: { name: 'Unauthorized', Ctor: UnauthorizedError },
  7: { name: 'InvalidDiscountRate', Ctor: InvalidDiscountRateError },
  8: { name: 'InvoiceExpired', Ctor: InvoiceExpiredError },
  9: { name: 'InvoiceDefaulted', Ctor: InvoiceDefaultedError },
  12: { name: 'FundingAmountExceeded', Ctor: FundingAmountExceededError },
};

const CONTRACT_ERROR_PATTERNS: Array<{
  pattern: string;
  Ctor: typeof ILNError;
}> = [
  { pattern: 'InvalidDiscountRate', Ctor: InvalidDiscountRateError },
  { pattern: 'TokenMismatch', Ctor: TokenMismatchError },
  { pattern: 'PayerReputationTooLow', Ctor: PayerReputationTooLowError },
  { pattern: 'InvoiceNotFound', Ctor: InvoiceNotFoundError },
  { pattern: 'InvoiceAlreadyFunded', Ctor: InvoiceAlreadyFundedError },
  { pattern: 'InvoiceAlreadyPaid', Ctor: InvoiceAlreadyPaidError },
  { pattern: 'InvoiceNotFunded', Ctor: InvoiceNotFundedError },
  { pattern: 'Unauthorized', Ctor: UnauthorizedError },
  { pattern: 'InvoiceExpired', Ctor: InvoiceExpiredError },
  { pattern: 'InvoiceDefaulted', Ctor: InvoiceDefaultedError },
  { pattern: 'FundingAmountExceeded', Ctor: FundingAmountExceededError },
];

/**
 * Parse a raw contract error (XDR string, numeric code, or error object)
 * into a typed ILNError with detailed debugging context.
 *
 * @param xdrError - The raw error value from the contract simulation/invocation.
 * @param signature - Optional function signature or operation name for context.
 * @returns A typed ILNError instance.
 */
export function parseContractError(xdrError: unknown, signature?: string): ILNError {
  const baseContext: Record<string, unknown> = {
    rawError: xdrError,
  };
  if (signature) {
    baseContext.matchedSignature = signature;
  }

  // Try numeric code matching first
  if (typeof xdrError === 'number' || (typeof xdrError === 'string' && /^\d+$/.test(xdrError))) {
    const code = typeof xdrError === 'number' ? xdrError : parseInt(xdrError, 10);
    const entry = CONTRACT_ERROR_MAP[code];
    if (entry) {
      if (entry.Ctor === InvoiceNotFoundError) {
        return new InvoiceNotFoundError('unknown', { ...baseContext, matchedPattern: entry.name, errorCode: code });
      }
      return new entry.Ctor({ ...baseContext, matchedPattern: entry.name, errorCode: code });
    }
  }

  const errorStr = typeof xdrError === 'string' ? xdrError : JSON.stringify(xdrError);

  // Try string pattern matching
  for (const { pattern, Ctor } of CONTRACT_ERROR_PATTERNS) {
    if (errorStr.includes(pattern)) {
      if (Ctor === InvoiceNotFoundError) {
        return new InvoiceNotFoundError('unknown', { ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === InvalidDiscountRateError) {
        return new InvalidDiscountRateError({ ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === TokenMismatchError) {
        return new TokenMismatchError({ ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === PayerReputationTooLowError) {
        return new PayerReputationTooLowError({ ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === UnauthorizedError) {
        return new UnauthorizedError(undefined, { ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === InvoiceAlreadyFundedError) {
        return new InvoiceAlreadyFundedError('unknown', { ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === InvoiceAlreadyPaidError) {
        return new InvoiceAlreadyPaidError('unknown', { ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === InvoiceNotFundedError) {
        return new InvoiceNotFundedError('unknown', { ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === InvoiceExpiredError) {
        return new InvoiceExpiredError('unknown', { ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === InvoiceDefaultedError) {
        return new InvoiceDefaultedError('unknown', { ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
      if (Ctor === FundingAmountExceededError) {
        return new FundingAmountExceededError(undefined, { ...baseContext, matchedPattern: pattern, rawErrorString: errorStr });
      }
    }
  }

  return new GenericContractError(errorStr, {
    ...baseContext,
    matchedPattern: 'Unknown',
    rawErrorString: errorStr,
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
  fallbackMessage = 'An unexpected error occurred.',
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
      },
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
    },
  );
}

/** Alias for normalizeError */
export const toILNError = normalizeError;

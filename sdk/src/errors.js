/**
 * Base error class for all ILN SDK errors.
 */
export class ILNError extends Error {
  constructor(message, code, remediation, options) {
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

function withDocs(code) {
  return `${DEFAULT_DOCS_BASE_URL}#${code.toLowerCase()}`;
}

export class InvalidDiscountRateError extends ILNError {
  constructor(context) {
    super(
      'Invalid discount rate.',
      'INVALID_DISCOUNT_RATE',
      'Check `discountRate` is within protocol bounds (see `getProtocolConfig().maxDiscountRate`). If using basis points, ensure value is in bps (e.g., 300 = 3%).',
      {
        docsUrl: withDocs('INVALID_DISCOUNT_RATE'),
        context,
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TokenMismatchError extends ILNError {
  constructor(context) {
    super(
      'Token mismatch in transaction.',
      'TOKEN_MISMATCH',
      'Verify that the token contract ID/address used matches the token configured for the invoice/protocol.',
      {
        docsUrl: withDocs('TOKEN_MISMATCH'),
        context,
        retryable: false,
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PayerReputationTooLowError extends ILNError {
  constructor(context) {
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

export class InsufficientBalanceError extends ILNError {
  constructor(
    message = 'Insufficient balance to complete the transaction.',
    remediation = 'Ensure the account has enough funds (including transaction fees) before retrying. If you are on testnet, fund the account and re-submit.',
    context,
  ) {
    super(message, 'INSUFFICIENT_BALANCE', remediation, {
      docsUrl: withDocs('INSUFFICIENT_BALANCE'),
      context,
      retryable: true,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NetworkError extends ILNError {
  constructor(
    message = 'Network request failed.',
    remediation = 'Failed to reach the configured Stellar RPC endpoint. Verify your `rpcUrl`, check connectivity, and ensure the RPC server is healthy.',
    context,
  ) {
    super(message, 'NETWORK_ERROR', remediation, {
      docsUrl: withDocs('NETWORK_ERROR'),
      context,
      retryable: true,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TransactionFailedError extends ILNError {
  constructor(
    message = 'Transaction execution failed on-chain.',
    remediation = 'The contract rejected the transaction. Review simulation/tx failure reason, verify invoice state, and confirm fee/resource settings.',
    context,
  ) {
    super(message, 'TRANSACTION_FAILED', remediation, {
      docsUrl: withDocs('TRANSACTION_FAILED'),
      context,
      retryable: false,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends ILNError {
  constructor(
    message = 'Validation failed.',
    remediation = 'Check provided input parameters. Use `Validators` to validate fields and inspect which constraint failed.',
    context,
  ) {
    super(message, 'VALIDATION_ERROR', remediation, {
      docsUrl: withDocs('VALIDATION_ERROR'),
      context,
      retryable: false,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WalletNotConnectedError extends ILNError {
  constructor(
    message = 'Wallet is not connected.',
    remediation = 'A transaction signer is required for this state-changing operation. Provide a `signer` in the `ILNSdk` configuration or ensure wallet is connected.',
    context,
  ) {
    super(message, 'WALLET_NOT_CONNECTED', remediation, {
      docsUrl: withDocs('WALLET_NOT_CONNECTED'),
      context,
      retryable: false,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class GenericContractError extends ILNError {
  constructor(rawError, context) {
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
      },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SimulationError extends ILNError {
  constructor(
    message = 'Transaction simulation failed.',
    remediation = 'The SDK could not simulate the transaction successfully. Review transaction parameters and ensure contract state is consistent before retrying.',
    context,
  ) {
    super(message, 'SIMULATION_FAILED', remediation, {
      docsUrl: withDocs('SIMULATION_FAILED'),
      context,
      retryable: false,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function parseContractError(xdrError, signature) {
  const errorStr = typeof xdrError === 'string' ? xdrError : JSON.stringify(xdrError);

  const baseContext = {
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
    return new PayerReputationTooLowError({ ...baseContext, matchedPattern: 'PayerReputationTooLow' });
  }

  return new GenericContractError(errorStr, {
    ...baseContext,
    matchedPattern: 'Unknown',
  });
}

export function normalizeError(
  err,
  fallbackCode = 'UNKNOWN_ERROR',
  fallbackMessage = 'An unexpected error occurred.'
) {
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

export const toILNError = normalizeError;

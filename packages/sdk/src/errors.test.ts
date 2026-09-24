import {
  ILNError,
  InvoiceNotFoundError,
  InvoiceAlreadyFundedError,
  InvoiceAlreadyPaidError,
  InvoiceNotFundedError,
  InvoiceDefaultedError,
  InvoiceExpiredError,
  FundingAmountExceededError,
  InsufficientBalanceError,
  NetworkError,
  TimeoutError,
  UnauthorizedError,
  WalletNotConnectedError,
  TokenMismatchError,
  InvalidDiscountRateError,
  PayerReputationTooLowError,
  ContractCallError,
  GenericContractError,
  TransactionFailedError,
  SimulationError,
  ValidationError,
  XDRParseError,
  InvalidAddressError,
  RateLimitError,
  parseContractError,
  normalizeError,
  toILNError,
} from './errors';

describe('ILNError base class', () => {
  it('creates error with structured fields', () => {
    const err = new ILNError('test', 'TEST_CODE', 'fix it', {
      docsUrl: 'https://docs.example.com',
      context: { foo: 'bar' },
      retryable: true,
      cause: new Error('original'),
    });

    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.remediation).toBe('fix it');
    expect(err.docsUrl).toBe('https://docs.example.com');
    expect(err.context).toEqual({ foo: 'bar' });
    expect(err.retryable).toBe(true);
    expect(err.cause).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ILNError);
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves prototype chain for instanceof checks', () => {
    const err = new ILNError('test', 'CODE', 'fix');
    expect(err).toBeInstanceOf(ILNError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ILNError');
  });

  it('has unique programmatic error codes across all error classes', () => {
    const errors = [
      new InvoiceNotFoundError(1),
      new InvoiceAlreadyFundedError(1),
      new InvoiceAlreadyPaidError(1),
      new InvoiceNotFundedError(1),
      new InvoiceDefaultedError(1),
      new InvoiceExpiredError(1),
      new FundingAmountExceededError(),
      new InsufficientBalanceError(),
      new NetworkError(),
      new TimeoutError('op'),
      new UnauthorizedError(),
      new WalletNotConnectedError(),
      new TokenMismatchError(),
      new InvalidDiscountRateError(),
      new PayerReputationTooLowError(),
      new ContractCallError('fail'),
      new GenericContractError('raw'),
      new TransactionFailedError(),
      new SimulationError(),
      new ValidationError(),
      new XDRParseError(),
      new InvalidAddressError(),
      new RateLimitError(),
    ];

    const codes = errors.map((e) => e.code);
    const uniqueCodes = new Set(codes);
    // ContractCallError and GenericContractError intentionally share 'CONTRACT_ERROR'
    expect(uniqueCodes.size).toBe(errors.length - 1);
  });

  it('populates docsUrl on all error classes', () => {
    const errors = [
      new InvoiceNotFoundError(1),
      new InvoiceAlreadyFundedError(1),
      new InvoiceAlreadyPaidError(1),
      new InvoiceNotFundedError(1),
      new InvoiceDefaultedError(1),
      new InvoiceExpiredError(1),
      new FundingAmountExceededError(),
      new InsufficientBalanceError(),
      new NetworkError(),
      new TimeoutError('op'),
      new UnauthorizedError(),
      new WalletNotConnectedError(),
      new TokenMismatchError(),
      new InvalidDiscountRateError(),
      new PayerReputationTooLowError(),
      new ContractCallError('fail'),
      new GenericContractError('raw'),
      new TransactionFailedError(),
      new SimulationError(),
      new ValidationError(),
      new XDRParseError(),
      new InvalidAddressError(),
      new RateLimitError(),
    ];

    for (const err of errors) {
      expect(err.docsUrl).toBeDefined();
      expect(err.docsUrl).toContain('docs/errors.md#');
      expect(err.docsUrl).toContain(err.code.toLowerCase());
    }
  });
});

describe('Invoice errors', () => {
  it('InvoiceNotFoundError has correct fields', () => {
    const err = new InvoiceNotFoundError(42, { source: 'test' });
    expect(err.code).toBe('INVOICE_NOT_FOUND');
    expect(err.message).toContain('#42');
    expect(err.retryable).toBe(false);
    expect(err.context?.invoiceId).toBe(42);
    expect(err.context?.source).toBe('test');
    expect(err).toBeInstanceOf(InvoiceNotFoundError);
    expect(err).toBeInstanceOf(ILNError);
  });

  it('InvoiceAlreadyFundedError has correct fields', () => {
    const err = new InvoiceAlreadyFundedError(7);
    expect(err.code).toBe('INVOICE_ALREADY_FUNDED');
    expect(err.message).toContain('#7');
    expect(err.retryable).toBe(false);
  });

  it('InvoiceAlreadyPaidError has correct fields', () => {
    const err = new InvoiceAlreadyPaidError(10);
    expect(err.code).toBe('INVOICE_ALREADY_PAID');
    expect(err.message).toContain('#10');
    expect(err.retryable).toBe(false);
  });

  it('InvoiceNotFundedError has correct fields', () => {
    const err = new InvoiceNotFundedError(5);
    expect(err.code).toBe('INVOICE_NOT_FUNDED');
    expect(err.message).toContain('#5');
    expect(err.retryable).toBe(false);
  });

  it('InvoiceDefaultedError has correct fields', () => {
    const err = new InvoiceDefaultedError(3);
    expect(err.code).toBe('INVOICE_DEFAULTED');
    expect(err.retryable).toBe(false);
  });

  it('InvoiceExpiredError has correct fields', () => {
    const err = new InvoiceExpiredError(99);
    expect(err.code).toBe('INVOICE_EXPIRED');
    expect(err.retryable).toBe(false);
  });
});

describe('Funding errors', () => {
  it('FundingAmountExceededError is non-retryable', () => {
    const err = new FundingAmountExceededError('Amount too high', { amount: '5000' });
    expect(err.code).toBe('FUNDING_AMOUNT_EXCEEDED');
    expect(err.retryable).toBe(false);
  });

  it('InsufficientBalanceError is retryable', () => {
    const err = new InsufficientBalanceError();
    expect(err.code).toBe('INSUFFICIENT_BALANCE');
    expect(err.retryable).toBe(true);
  });
});

describe('Network errors', () => {
  it('NetworkError is retryable', () => {
    const err = new NetworkError('Connection refused', undefined, { url: 'http://rpc.test' });
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('TimeoutError is retryable', () => {
    const err = new TimeoutError('fetchInvoice', 5000);
    expect(err.code).toBe('TIMEOUT');
    expect(err.retryable).toBe(true);
    expect(err.context?.operation).toBe('fetchInvoice');
    expect(err.context?.timeoutMs).toBe(5000);
  });

  it('RateLimitError is retryable', () => {
    const err = new RateLimitError('Too many requests', 2000);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryable).toBe(true);
    expect(err.context?.retryAfterMs).toBe(2000);
  });

  it('SimulationError is retryable', () => {
    const err = new SimulationError();
    expect(err.code).toBe('SIMULATION_FAILED');
    expect(err.retryable).toBe(true);
  });
});

describe('Auth errors', () => {
  it('UnauthorizedError has correct fields', () => {
    const err = new UnauthorizedError('fund_invoice');
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.message).toContain('fund_invoice');
    expect(err.retryable).toBe(false);
  });

  it('WalletNotConnectedError has correct fields', () => {
    const err = new WalletNotConnectedError();
    expect(err.code).toBe('WALLET_NOT_CONNECTED');
    expect(err.retryable).toBe(false);
  });
});

describe('Token and contract errors', () => {
  it('TokenMismatchError is non-retryable', () => {
    const err = new TokenMismatchError();
    expect(err.code).toBe('TOKEN_MISMATCH');
    expect(err.retryable).toBe(false);
  });

  it('InvalidDiscountRateError is non-retryable', () => {
    const err = new InvalidDiscountRateError();
    expect(err.code).toBe('INVALID_DISCOUNT_RATE');
    expect(err.retryable).toBe(false);
  });

  it('PayerReputationTooLowError is non-retryable', () => {
    const err = new PayerReputationTooLowError();
    expect(err.code).toBe('PAYER_REPUTATION_TOO_LOW');
    expect(err.retryable).toBe(false);
  });

  it('ContractCallError preserves contractId and method', () => {
    const err = new ContractCallError('Simulation failed', 'CA3D...', 'get_reputation');
    expect(err.code).toBe('CONTRACT_ERROR');
    expect(err.contractId).toBe('CA3D...');
    expect(err.method).toBe('get_reputation');
    expect(err.retryable).toBe(false);
  });

  it('GenericContractError wraps raw error', () => {
    const err = new GenericContractError('UnknownPanic(42)');
    expect(err.code).toBe('CONTRACT_ERROR');
    expect(err.context?.rawError).toBe('UnknownPanic(42)');
  });

  it('TransactionFailedError is non-retryable', () => {
    const err = new TransactionFailedError();
    expect(err.code).toBe('TRANSACTION_FAILED');
    expect(err.retryable).toBe(false);
  });
});

describe('Other error types', () => {
  it('ValidationError with custom remediation', () => {
    const err = new ValidationError('Bad input', 'Check field X', { field: 'X' });
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.remediation).toBe('Check field X');
    expect(err.retryable).toBe(false);
  });

  it('XDRParseError', () => {
    const err = new XDRParseError('Bad XDR');
    expect(err.code).toBe('XDR_PARSE_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('InvalidAddressError preserves address', () => {
    const err = new InvalidAddressError('Bad format', 'GINVALID...');
    expect(err.code).toBe('INVALID_ADDRESS');
    expect(err.address).toBe('GINVALID...');
    expect(err.retryable).toBe(false);
  });
});

describe('parseContractError', () => {
  it('maps numeric contract error code 1 to InvoiceNotFoundError', () => {
    const err = parseContractError(1, 'get_invoice');
    expect(err).toBeInstanceOf(InvoiceNotFoundError);
    expect(err.code).toBe('INVOICE_NOT_FOUND');
    expect(err.context?.errorCode).toBe(1);
    expect(err.context?.matchedSignature).toBe('get_invoice');
  });

  it('maps numeric code 2 to InvoiceAlreadyFundedError', () => {
    const err = parseContractError(2);
    expect(err).toBeInstanceOf(InvoiceAlreadyFundedError);
    expect(err.code).toBe('INVOICE_ALREADY_FUNDED');
  });

  it('maps numeric code 5 to UnauthorizedError', () => {
    const err = parseContractError(5);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('maps numeric code as string', () => {
    const err = parseContractError('7');
    expect(err).toBeInstanceOf(InvalidDiscountRateError);
    expect(err.code).toBe('INVALID_DISCOUNT_RATE');
  });

  it('maps string pattern "InvalidDiscountRate" to InvalidDiscountRateError', () => {
    const err = parseContractError('Error: InvalidDiscountRate', 'submit_invoice');
    expect(err).toBeInstanceOf(InvalidDiscountRateError);
    expect(err.code).toBe('INVALID_DISCOUNT_RATE');
    expect(err.context?.matchedSignature).toBe('submit_invoice');
    expect(err.context?.matchedPattern).toBe('InvalidDiscountRate');
  });

  it('maps string pattern "TokenMismatch"', () => {
    const err = parseContractError('Error: TokenMismatch');
    expect(err).toBeInstanceOf(TokenMismatchError);
    expect(err.code).toBe('TOKEN_MISMATCH');
  });

  it('maps string pattern "PayerReputationTooLow"', () => {
    const err = parseContractError('Error: PayerReputationTooLow');
    expect(err).toBeInstanceOf(PayerReputationTooLowError);
    expect(err.code).toBe('PAYER_REPUTATION_TOO_LOW');
  });

  it('maps string pattern "InvoiceNotFound"', () => {
    const err = parseContractError('InvoiceNotFound');
    expect(err).toBeInstanceOf(InvoiceNotFoundError);
    expect(err.code).toBe('INVOICE_NOT_FOUND');
  });

  it('maps unknown contract errors to GenericContractError', () => {
    const err = parseContractError('UnknownContractPanic(42)', 'fund_invoice');
    expect(err).toBeInstanceOf(GenericContractError);
    expect(err.code).toBe('CONTRACT_ERROR');
    expect(err.context?.matchedPattern).toBe('Unknown');
    expect(err.context?.matchedSignature).toBe('fund_invoice');
  });

  it('wraps non-string errors into JSON string for matching', () => {
    const err = parseContractError({ message: 'TokenMismatch in fn' });
    expect(err).toBeInstanceOf(TokenMismatchError);
  });
});

describe('normalizeError / toILNError', () => {
  it('returns an existing ILNError instance unchanged', () => {
    const orig = new InsufficientBalanceError();
    const normalized = normalizeError(orig);
    expect(normalized).toBe(orig);
  });

  it('wraps standard JS Error objects into ILNError', () => {
    const jsErr = new TypeError('Cannot read properties of undefined');
    const normalized = normalizeError(jsErr, 'TYPE_ERROR', 'A type error occurred.');

    expect(normalized).toBeInstanceOf(ILNError);
    expect(normalized.code).toBe('TYPE_ERROR');
    expect(normalized.message).toBe('Cannot read properties of undefined');
    expect(normalized.cause).toBe(jsErr);
    expect(normalized.docsUrl).toContain('docs/errors.md#type_error');
  });

  it('parses error strings into ILNError using parseContractError', () => {
    const normalized = normalizeError('Error: InvalidDiscountRate');
    expect(normalized).toBeInstanceOf(InvalidDiscountRateError);
    expect(normalized.code).toBe('INVALID_DISCOUNT_RATE');
  });

  it('wraps arbitrary non-Error values into structured ILNError', () => {
    const objErr = { status: 500, detail: 'Internal Gateway Timeout' };
    const normalized = normalizeError(objErr, 'GATEWAY_ERROR');

    expect(normalized).toBeInstanceOf(ILNError);
    expect(normalized.code).toBe('GATEWAY_ERROR');
    expect(normalized.context).toBeDefined();
    expect(normalized.context?.raw).toEqual(objErr);
  });

  it('aliases toILNError to normalizeError', () => {
    expect(toILNError).toBe(normalizeError);
  });

  it('wraps null/undefined into ILNError', () => {
    const normalized = normalizeError(null);
    expect(normalized).toBeInstanceOf(ILNError);
    expect(normalized.code).toBe('UNKNOWN_ERROR');
  });
});

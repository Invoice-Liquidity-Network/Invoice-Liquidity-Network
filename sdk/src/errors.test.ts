import { describe, it, expect } from 'vitest';
import {
  parseContractError,
  normalizeError,
  toILNError,
  InvalidDiscountRateError,
  TokenMismatchError,
  PayerReputationTooLowError,
  GenericContractError,
  InsufficientBalanceError,
  NetworkError,
  TransactionFailedError,
  ValidationError,
  WalletNotConnectedError,
  SimulationError,
  ILNError,
} from './errors';

describe('SDK Structured Error Handling', () => {
  it('maps known contract error strings to specific error types', () => {
    const errRate = parseContractError('Error: InvalidDiscountRate', 'submit_invoice');
    expect(errRate).toBeInstanceOf(InvalidDiscountRateError);
    expect(errRate.code).toBe('INVALID_DISCOUNT_RATE');
    expect(errRate.context).toMatchObject({
      rawError: 'Error: InvalidDiscountRate',
      matchedSignature: 'submit_invoice',
      matchedPattern: 'InvalidDiscountRate',
    });

    const errToken = parseContractError('Error: TokenMismatch');
    expect(errToken).toBeInstanceOf(TokenMismatchError);
    expect(errToken.code).toBe('TOKEN_MISMATCH');

    const errPayer = parseContractError('Error: PayerReputationTooLow');
    expect(errPayer).toBeInstanceOf(PayerReputationTooLowError);
    expect(errPayer.code).toBe('PAYER_REPUTATION_TOO_LOW');
  });

  it('maps unclassified contract errors to GenericContractError with raw context and signature', () => {
    const err = parseContractError('UnknownContractPanic(42)', 'fund_invoice');
    expect(err).toBeInstanceOf(GenericContractError);
    expect(err.code).toBe('CONTRACT_ERROR');
    expect(err.context).toMatchObject({
      rawError: 'UnknownContractPanic(42)',
      matchedSignature: 'fund_invoice',
      matchedPattern: 'Unknown',
    });
  });

  describe('ILNError prototype & structured fields', () => {
    it('preserves prototype chain for instanceof checks', () => {
      const balanceErr = new InsufficientBalanceError();
      const networkErr = new NetworkError();
      const txErr = new TransactionFailedError();
      const valErr = new ValidationError();
      const walletErr = new WalletNotConnectedError();
      const simErr = new SimulationError();

      expect(balanceErr).toBeInstanceOf(InsufficientBalanceError);
      expect(balanceErr).toBeInstanceOf(ILNError);
      expect(balanceErr).toBeInstanceOf(Error);

      expect(networkErr).toBeInstanceOf(NetworkError);
      expect(networkErr).toBeInstanceOf(ILNError);

      expect(txErr).toBeInstanceOf(TransactionFailedError);
      expect(txErr).toBeInstanceOf(ILNError);

      expect(valErr).toBeInstanceOf(ValidationError);
      expect(valErr).toBeInstanceOf(ILNError);

      expect(walletErr).toBeInstanceOf(WalletNotConnectedError);
      expect(walletErr).toBeInstanceOf(ILNError);

      expect(simErr).toBeInstanceOf(SimulationError);
      expect(simErr).toBeInstanceOf(ILNError);
    });

    it('has unique programmatic error codes across all SDK error classes', () => {
      const errors = [
        new InvalidDiscountRateError(),
        new TokenMismatchError(),
        new PayerReputationTooLowError(),
        new InsufficientBalanceError(),
        new NetworkError(),
        new TransactionFailedError(),
        new ValidationError(),
        new WalletNotConnectedError(),
        new GenericContractError('raw'),
        new SimulationError(),
      ];

      const codes = errors.map((e) => e.code);
      const uniqueCodes = new Set(codes);

      expect(uniqueCodes.size).toBe(errors.length);
    });

    it('populates docsUrl on all SDK errors', () => {
      const errors = [
        new InvalidDiscountRateError(),
        new TokenMismatchError(),
        new PayerReputationTooLowError(),
        new InsufficientBalanceError(),
        new NetworkError(),
        new TransactionFailedError(),
        new ValidationError(),
        new WalletNotConnectedError(),
        new GenericContractError('raw'),
        new SimulationError(),
      ];

      for (const err of errors) {
        expect(err.docsUrl).toBeDefined();
        expect(err.docsUrl).toContain('docs/errors.md#');
        expect(err.docsUrl).toContain(err.code.toLowerCase());
      }
    });

    it('supports custom remediation strategies and context propagation', () => {
      const customMsg = 'Custom validation error details';
      const customRemedy = 'Please enter valid address string';
      const ctx = { field: 'discountRate', value: -5 };
      const valErr = new ValidationError(customMsg, customRemedy, ctx);

      expect(valErr.message).toBe(customMsg);
      expect(valErr.remediation).toBe(customRemedy);
      expect(valErr.context).toEqual(ctx);
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

    it('wraps arbitrary non-Error values and objects into structured ILNError', () => {
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
  });
});

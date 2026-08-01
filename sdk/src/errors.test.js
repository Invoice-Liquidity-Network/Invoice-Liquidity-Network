import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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
} from './errors.js';

describe('SDK Structured Error Handling', () => {
  test('maps known contract error strings to specific error types', () => {
    const errRate = parseContractError('Error: InvalidDiscountRate', 'submit_invoice');
    assert.ok(errRate instanceof InvalidDiscountRateError);
    assert.equal(errRate.code, 'INVALID_DISCOUNT_RATE');
    assert.deepEqual(errRate.context, {
      rawError: 'Error: InvalidDiscountRate',
      rawErrorString: 'Error: InvalidDiscountRate',
      matchedSignature: 'submit_invoice',
      matchedPattern: 'InvalidDiscountRate',
    });

    const errToken = parseContractError('Error: TokenMismatch');
    assert.ok(errToken instanceof TokenMismatchError);
    assert.equal(errToken.code, 'TOKEN_MISMATCH');

    const errPayer = parseContractError('Error: PayerReputationTooLow');
    assert.ok(errPayer instanceof PayerReputationTooLowError);
    assert.equal(errPayer.code, 'PAYER_REPUTATION_TOO_LOW');
  });

  test('maps unclassified contract errors to GenericContractError with raw context and signature', () => {
    const err = parseContractError('UnknownContractPanic(42)', 'fund_invoice');
    assert.ok(err instanceof GenericContractError);
    assert.equal(err.code, 'CONTRACT_ERROR');
    assert.deepEqual(err.context, {
      rawError: 'UnknownContractPanic(42)',
      rawErrorString: 'UnknownContractPanic(42)',
      matchedSignature: 'fund_invoice',
      matchedPattern: 'Unknown',
    });
  });

  describe('ILNError prototype & structured fields', () => {
    test('preserves prototype chain for instanceof checks', () => {
      const balanceErr = new InsufficientBalanceError();
      const networkErr = new NetworkError();
      const txErr = new TransactionFailedError();
      const valErr = new ValidationError();
      const walletErr = new WalletNotConnectedError();
      const simErr = new SimulationError();

      assert.ok(balanceErr instanceof InsufficientBalanceError);
      assert.ok(balanceErr instanceof ILNError);
      assert.ok(balanceErr instanceof Error);

      assert.ok(networkErr instanceof NetworkError);
      assert.ok(networkErr instanceof ILNError);

      assert.ok(txErr instanceof TransactionFailedError);
      assert.ok(txErr instanceof ILNError);

      assert.ok(valErr instanceof ValidationError);
      assert.ok(valErr instanceof ILNError);

      assert.ok(walletErr instanceof WalletNotConnectedError);
      assert.ok(walletErr instanceof ILNError);

      assert.ok(simErr instanceof SimulationError);
      assert.ok(simErr instanceof ILNError);
    });

    test('has unique programmatic error codes across all SDK error classes', () => {
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

      assert.equal(uniqueCodes.size, errors.length);
    });

    test('populates docsUrl on all SDK errors', () => {
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
        assert.ok(err.docsUrl !== undefined);
        assert.ok(err.docsUrl.includes('docs/errors.md#'));
        assert.ok(err.docsUrl.includes(err.code.toLowerCase()));
      }
    });

    test('supports custom remediation strategies and context propagation', () => {
      const customMsg = 'Custom validation error details';
      const customRemedy = 'Please enter valid address string';
      const ctx = { field: 'discountRate', value: -5 };
      const valErr = new ValidationError(customMsg, customRemedy, ctx);

      assert.equal(valErr.message, customMsg);
      assert.equal(valErr.remediation, customRemedy);
      assert.deepEqual(valErr.context, ctx);
    });
  });

  describe('normalizeError / toILNError', () => {
    test('returns an existing ILNError instance unchanged', () => {
      const orig = new InsufficientBalanceError();
      const normalized = normalizeError(orig);
      assert.equal(normalized, orig);
    });

    test('wraps standard JS Error objects into ILNError', () => {
      const jsErr = new TypeError('Cannot read properties of undefined');
      const normalized = normalizeError(jsErr, 'TYPE_ERROR', 'A type error occurred.');

      assert.ok(normalized instanceof ILNError);
      assert.equal(normalized.code, 'TYPE_ERROR');
      assert.equal(normalized.message, 'Cannot read properties of undefined');
      assert.equal(normalized.cause, jsErr);
      assert.ok(normalized.docsUrl.includes('docs/errors.md#type_error'));
    });

    test('parses error strings into ILNError using parseContractError', () => {
      const normalized = normalizeError('Error: InvalidDiscountRate');
      assert.ok(normalized instanceof InvalidDiscountRateError);
      assert.equal(normalized.code, 'INVALID_DISCOUNT_RATE');
    });

    test('wraps arbitrary non-Error values and objects into structured ILNError', () => {
      const objErr = { status: 500, detail: 'Internal Gateway Timeout' };
      const normalized = normalizeError(objErr, 'GATEWAY_ERROR');

      assert.ok(normalized instanceof ILNError);
      assert.equal(normalized.code, 'GATEWAY_ERROR');
      assert.ok(normalized.context !== undefined);
      assert.deepEqual(normalized.context.raw, objErr);
    });

    test('aliases toILNError to normalizeError', () => {
      assert.equal(toILNError, normalizeError);
    });
  });
});

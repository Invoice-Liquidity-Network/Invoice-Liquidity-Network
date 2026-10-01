/**
 * Tests for structured SDK error surfacing in CLI output (#705).
 *
 * Verifies that `formatILNError` renders the SDK's structured `ILNError`
 * fields — message, code, remediation hint, and docs link — for terminal
 * output, including the OSC 8 hyperlink escape when enabled.
 */

import { describe, expect, it } from 'vitest';

import { formatILNError, isStructuredError, osc8Hyperlink } from '../src/errors';

import { InvalidDiscountRateError, TokenMismatchError, NetworkError } from '@iln/sdk';

// Strip ANSI so assertions are colour-independent.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

describe('isStructuredError', () => {
  it('recognises ILNError subclasses', () => {
    expect(isStructuredError(new InvalidDiscountRateError())).toBe(true);
    expect(isStructuredError(new TokenMismatchError())).toBe(true);
  });

  it('rejects plain errors and non-objects', () => {
    expect(isStructuredError(new Error('boom'))).toBe(false);
    expect(isStructuredError('boom')).toBe(false);
    expect(isStructuredError(null)).toBe(false);
  });
});

describe('formatILNError', () => {
  it('includes message, code, remediation and docs link for InvalidDiscountRateError', () => {
    const err = new InvalidDiscountRateError();
    const out = stripAnsi(formatILNError(err, { color: false }));

    expect(out).toContain(err.message);
    expect(out).toContain('INVALID_DISCOUNT_RATE');
    expect(out).toContain(err.remediation);
    expect(out).toContain(err.docsUrl!);
  });

  it('surfaces remediation and docs link for TokenMismatchError', () => {
    const err = new TokenMismatchError();
    const out = stripAnsi(formatILNError(err, { color: false }));

    expect(out).toContain('TOKEN_MISMATCH');
    expect(out).toContain(err.remediation);
    expect(out).toContain(err.docsUrl!);
  });

  it('marks retryable errors and links docs for NetworkError', () => {
    const err = new NetworkError();
    expect(isStructuredError(err)).toBe(true);

    const out = stripAnsi(formatILNError(err, { color: false }));
    expect(out).toContain(err.remediation);
    if (err.docsUrl) expect(out).toContain(err.docsUrl);
    if (err.retryable) expect(out).toContain('retryable');
  });

  it('wraps the docs URL in an OSC 8 hyperlink when hyperlinks are enabled', () => {
    const err = new InvalidDiscountRateError();
    const out = formatILNError(err, { color: false, hyperlinks: true });
    expect(out).toContain(osc8Hyperlink(err.docsUrl!, err.docsUrl!));
    // OSC 8 introducer must be present.
    expect(out).toContain(String.fromCharCode(27) + ']8;;');
  });

  it('emits a plain URL when hyperlinks are disabled', () => {
    const err = new InvalidDiscountRateError();
    const out = formatILNError(err, { color: false, hyperlinks: false });
    expect(out).not.toContain(String.fromCharCode(27) + ']8;;');
    expect(out).toContain(err.docsUrl!);
  });
});

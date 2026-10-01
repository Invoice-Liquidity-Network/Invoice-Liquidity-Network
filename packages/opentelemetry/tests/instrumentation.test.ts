import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ILNInstrumentation,
  sanitizeErrorMessage,
  sanitizeAttributeValue,
} from '../src/index';
import { trace, metrics } from '@opentelemetry/api';

const mockSetAttribute = vi.fn();
const mockSetStatus = vi.fn();
const mockEnd = vi.fn();

vi.mock('@opentelemetry/api', () => {
  const startSpan = vi.fn().mockImplementation(() => ({
    setAttribute: mockSetAttribute,
    setStatus: mockSetStatus,
    end: mockEnd,
  }));

  const record = vi.fn();
  const add = vi.fn();

  return {
    SpanStatusCode: {
      OK: 1,
      ERROR: 2,
    },
    trace: {
      getTracer: vi.fn().mockReturnValue({
        startSpan,
      }),
    },
    metrics: {
      getMeter: vi.fn().mockReturnValue({
        createHistogram: vi.fn().mockReturnValue({ record }),
        createCounter: vi.fn().mockReturnValue({ add }),
      }),
    },
  };
});

class MockClient {
  async submitInvoice(params: any) {
    return { success: true };
  }

  async simulateTransaction(params: any) {
    return { success: true };
  }

  async fundInvoice(params: any) {
    throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });
  }

  async failedWithSecret(params: any) {
    throw new Error(
      'Transaction failed with secret key SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX for user'
    );
  }

  async failedWithXdrAndBearer(params: any) {
    const hugeXdr = 'A'.repeat(80);
    throw new Error(
      `Auth error Bearer secret-token-12345: Transaction XDR ${hugeXdr} rejected by RPC node`
    );
  }
}

describe('ILNInstrumentation & Sensitive Data Redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Utility: sanitizeErrorMessage', () => {
    it('redacts Stellar secret keys', () => {
      const secret = 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      const msg = `Invalid seed: ${secret} provided`;
      expect(sanitizeErrorMessage(msg)).toBe('Invalid seed: [REDACTED_SECRET_KEY] provided');
    });

    it('redacts Bearer authentication tokens', () => {
      const msg = 'Request failed with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
      expect(sanitizeErrorMessage(msg)).toBe('Request failed with Bearer [REDACTED_AUTH_TOKEN]');
    });

    it('redacts long base64 XDR payloads', () => {
      const longXdr = 'AAAAAgAAAABnZgAAAADa1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890+/==';
      const msg = `Soroban simulation failed on payload ${longXdr} at ledger 100`;
      expect(sanitizeErrorMessage(msg)).toBe('Soroban simulation failed on payload [REDACTED_XDR_PAYLOAD] at ledger 100');
    });

    it('truncates oversized error messages', () => {
      const longMsg = 'Error occurred in processing stage: '.repeat(20);
      const sanitized = sanitizeErrorMessage(longMsg, 100);
      expect(sanitized.length).toBeLessThan(120);
      expect(sanitized).toContain('[TRUNCATED]');
    });
  });

  describe('Utility: sanitizeAttributeValue', () => {
    it('converts bigint to string safely', () => {
      expect(sanitizeAttributeValue(100n)).toBe('100');
    });

    it('redacts secret keys if embedded in string attributes', () => {
      const secret = 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      expect(sanitizeAttributeValue(`key_${secret}`)).toBe('key_[REDACTED_SECRET_KEY]');
    });

    it('preserves numbers and booleans', () => {
      expect(sanitizeAttributeValue(42)).toBe(42);
      expect(sanitizeAttributeValue(true)).toBe(true);
    });
  });

  describe('Client Instrumentation & Span Attribute Filtering', () => {
    it('instruments client methods and records safe attributes (including bigint conversion)', async () => {
      const instrumentation = new ILNInstrumentation();
      const client = new MockClient();
      const instrumented = instrumentation.instrumentClient(client);

      await instrumented.submitInvoice({
        invoiceId: 101n,
        token: 'USDC',
        network: 'testnet',
        // Sensitive parameter that must NOT be captured as span attribute
        secretKey: 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        authHeader: 'Bearer secret_token',
        transactionXdr: 'AAAA...',
      });

      const tracer = trace.getTracer('test');
      expect(tracer.startSpan).toHaveBeenCalledWith('ILNClient.submitInvoice');

      // Check safe attributes were set
      expect(mockSetAttribute).toHaveBeenCalledWith('invoice_id', '101');
      expect(mockSetAttribute).toHaveBeenCalledWith('iln.invoice_id', '101');
      expect(mockSetAttribute).toHaveBeenCalledWith('token', 'USDC');
      expect(mockSetAttribute).toHaveBeenCalledWith('network', 'testnet');
      expect(mockSetAttribute).toHaveBeenCalledWith('status', 'success');

      // Sensitive fields must NEVER be set on the span
      expect(mockSetAttribute).not.toHaveBeenCalledWith('secretKey', expect.anything());
      expect(mockSetAttribute).not.toHaveBeenCalledWith('authHeader', expect.anything());
      expect(mockSetAttribute).not.toHaveBeenCalledWith('transactionXdr', expect.anything());
    });

    it('redacts sensitive data from error status and error metrics', async () => {
      const instrumentation = new ILNInstrumentation();
      const client = new MockClient();
      const instrumented = instrumentation.instrumentClient(client);

      await expect(instrumented.failedWithSecret({})).rejects.toThrow();

      expect(mockSetStatus).toHaveBeenCalledWith({
        code: 2,
        message: 'Transaction failed with secret key [REDACTED_SECRET_KEY] for user',
      });
    });

    it('redacts bearer tokens and XDR from error message', async () => {
      const instrumentation = new ILNInstrumentation();
      const client = new MockClient();
      const instrumented = instrumentation.instrumentClient(client);

      await expect(instrumented.failedWithXdrAndBearer({})).rejects.toThrow();

      expect(mockSetStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.not.stringContaining('secret-token-12345'),
        })
      );
      expect(mockSetStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('[REDACTED_AUTH_TOKEN]'),
        })
      );
      expect(mockSetStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('[REDACTED_XDR_PAYLOAD]'),
        })
      );
    });

    it('supports custom redactor hook', async () => {
      const instrumentation = new ILNInstrumentation({
        customRedactor: (key, val) => {
          if (key === 'token') return 'MASKED_TOKEN';
          return val;
        },
      });
      const client = new MockClient();
      const instrumented = instrumentation.instrumentClient(client);

      await instrumented.submitInvoice({ token: 'USDC' });
      expect(mockSetAttribute).toHaveBeenCalledWith('token', 'MASKED_TOKEN');
    });
  });
});

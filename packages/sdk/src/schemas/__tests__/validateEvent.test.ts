/**
 * packages/sdk/src/schemas/__tests__/validateEvent.test.ts
 *
 * Unit tests for the validateEvent() function.
 */

import { validateEvent, EventValidationError } from '../validateEvent';
import { SCHEMA_VERSION } from '../events';

const VALID_ADDRESS = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';

describe('validateEvent', () => {
  describe('input guards', () => {
    it('rejects null', () => {
      const result = validateEvent(null);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(EventValidationError);
        expect(result.error.code).toBe('EVENT_VALIDATION_ERROR');
      }
    });

    it('rejects undefined', () => {
      const result = validateEvent(undefined);
      expect(result.ok).toBe(false);
    });

    it('rejects primitives', () => {
      expect(validateEvent(42).ok).toBe(false);
      expect(validateEvent('string').ok).toBe(false);
      expect(validateEvent(true).ok).toBe(false);
    });

    it('rejects arrays', () => {
      const result = validateEvent([]);
      expect(result.ok).toBe(false);
    });
  });

  describe('event type detection', () => {
    it('detects type from "type" field', () => {
      const result = validateEvent({
        type: 'InvoiceSubmitted',
        invoiceId: 42n,
        freelancer: VALID_ADDRESS,
        payer: VALID_ADDRESS,
        token: VALID_ADDRESS,
        amount: 1000n,
        dueDate: 1700000000n,
        discountRate: 300,
        referralCode: { tag: 'None' },
        status: 'Pending',
        timestamp: 1699999999n,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects unknown event type', () => {
      const result = validateEvent({ type: 'UnknownEvent' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.eventType).toBe('UnknownEvent');
        expect(result.error.message).toContain('Unknown event type');
      }
    });

    it('rejects missing type field', () => {
      const result = validateEvent({ data: 'test' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Unable to detect event type');
      }
    });
  });

  describe('schema version', () => {
    it('validates with default version', () => {
      const result = validateEvent({
        type: 'ContractPaused',
        timestamp: 1n,
      });
      expect(result.ok).toBe(true);
    });

    it('validates with explicit current version', () => {
      const result = validateEvent(
        {
          type: 'ContractPaused',
          timestamp: 1n,
        },
        { schemaVersion: SCHEMA_VERSION }
      );
      expect(result.ok).toBe(true);
    });

    it('rejects mismatched version', () => {
      const result = validateEvent(
        {
          type: 'ContractPaused',
          timestamp: 1n,
        },
        { schemaVersion: 999 }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Schema version mismatch');
      }
    });
  });

  describe('validation errors', () => {
    it('returns structured error with Zod issues', () => {
      const result = validateEvent({
        type: 'InvoiceSubmitted',
        // Missing required fields
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.issues).toBeDefined();
        expect(result.error.issues.length).toBeGreaterThan(0);
        expect(result.error.issues[0]).toHaveProperty('path');
        expect(result.error.issues[0]).toHaveProperty('message');
        expect(result.error.issues[0]).toHaveProperty('code');
      }
    });

    it('includes event type in error', () => {
      const result = validateEvent({
        type: 'InvoiceSubmitted',
        invoiceId: 'not a bigint',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.eventType).toBe('InvoiceSubmitted');
      }
    });
  });

  describe('successful validation', () => {
    it('returns typed event with schema version', () => {
      const result = validateEvent({
        type: 'ContractPaused',
        timestamp: 12345n,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.event.type).toBe('ContractPaused');
        if (result.event.type === 'ContractPaused') {
          expect(result.event.timestamp).toBe(12345n);
        }
        expect(result.schemaVersion).toBe(SCHEMA_VERSION);
      }
    });

    it('strips extra fields', () => {
      const result = validateEvent({
        type: 'ContractPaused',
        timestamp: 1n,
        extra: 'field',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.event)).not.toContain('extra');
      }
    });
  });
});

describe('EventValidationError', () => {
  it('extends ILNError', () => {
    const error = new EventValidationError('test', {
      issues: [],
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('EVENT_VALIDATION_ERROR');
    expect(error.remediation).toBeDefined();
    expect(error.docsUrl).toBeDefined();
  });

  it('includes eventType', () => {
    const error = new EventValidationError('test', {
      eventType: 'InvoiceSubmitted',
      issues: [],
    });
    expect(error.eventType).toBe('InvoiceSubmitted');
  });

  it('includes formatted issues', () => {
    const error = new EventValidationError('test', {
      issues: [
        {
          path: ['field'],
          message: 'required',
          code: 'invalid_type',
        } as any,
      ],
    });
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0].path).toEqual(['field']);
    expect(error.issues[0].message).toBe('required');
  });

  it('includes context', () => {
    const error = new EventValidationError('test', {
      issues: [],
      context: { extra: 'info' },
    });
    expect(error.context).toBeDefined();
    expect(error.context?.extra).toBe('info');
  });
});

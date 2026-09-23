import { describe, it, expect } from 'vitest';
import {
  InvoiceStatus,
  isPending,
  isFunded,
  isPaid,
  isDefaulted,
  isDisputed,
  isTerminal,
  InvoiceStatusColor,
} from './invoice-status';

describe('InvoiceStatus enum', () => {
  it('has all required values', () => {
    expect(InvoiceStatus.Pending).toBe('Pending');
    expect(InvoiceStatus.Funded).toBe('Funded');
    expect(InvoiceStatus.Paid).toBe('Paid');
    expect(InvoiceStatus.Defaulted).toBe('Defaulted');
    expect(InvoiceStatus.Disputed).toBe('Disputed');
  });

  it('enum values are string literals for easy serialisation', () => {
    for (const value of Object.values(InvoiceStatus)) {
      expect(typeof value).toBe('string');
    }
  });
});

describe('isPending', () => {
  it('returns true for Pending', () => {
    expect(isPending(InvoiceStatus.Pending)).toBe(true);
    expect(isPending('Pending')).toBe(true);
  });

  it('returns false for all other statuses', () => {
    expect(isPending(InvoiceStatus.Funded)).toBe(false);
    expect(isPending(InvoiceStatus.Paid)).toBe(false);
    expect(isPending(InvoiceStatus.Defaulted)).toBe(false);
    expect(isPending(InvoiceStatus.Disputed)).toBe(false);
  });
});

describe('isFunded', () => {
  it('returns true for Funded', () => {
    expect(isFunded(InvoiceStatus.Funded)).toBe(true);
    expect(isFunded('Funded')).toBe(true);
  });

  it('returns false for other statuses', () => {
    expect(isFunded(InvoiceStatus.Pending)).toBe(false);
    expect(isFunded(InvoiceStatus.Paid)).toBe(false);
  });
});

describe('isPaid', () => {
  it('returns true for Paid', () => {
    expect(isPaid(InvoiceStatus.Paid)).toBe(true);
    expect(isPaid('Paid')).toBe(true);
  });

  it('returns false for other statuses', () => {
    expect(isPaid(InvoiceStatus.Pending)).toBe(false);
    expect(isPaid(InvoiceStatus.Funded)).toBe(false);
  });
});

describe('isDefaulted', () => {
  it('returns true for Defaulted', () => {
    expect(isDefaulted(InvoiceStatus.Defaulted)).toBe(true);
    expect(isDefaulted('Defaulted')).toBe(true);
  });

  it('returns false for other statuses', () => {
    expect(isDefaulted(InvoiceStatus.Pending)).toBe(false);
  });
});

describe('isDisputed', () => {
  it('returns true for Disputed', () => {
    expect(isDisputed(InvoiceStatus.Disputed)).toBe(true);
    expect(isDisputed('Disputed')).toBe(true);
  });

  it('returns false for other statuses', () => {
    expect(isDisputed(InvoiceStatus.Pending)).toBe(false);
    expect(isDisputed(InvoiceStatus.Funded)).toBe(false);
  });
});

describe('isTerminal', () => {
  it('returns true for terminal statuses (Paid, Defaulted, Disputed)', () => {
    expect(isTerminal(InvoiceStatus.Paid)).toBe(true);
    expect(isTerminal(InvoiceStatus.Defaulted)).toBe(true);
    expect(isTerminal(InvoiceStatus.Disputed)).toBe(true);
  });

  it('returns false for non-terminal statuses', () => {
    expect(isTerminal(InvoiceStatus.Pending)).toBe(false);
    expect(isTerminal(InvoiceStatus.Funded)).toBe(false);
  });
});

describe('InvoiceStatusColor', () => {
  it('has a hex color for every enum value', () => {
    for (const status of Object.values(InvoiceStatus)) {
      const color = InvoiceStatusColor[status];
      expect(color).toBeDefined();
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('Pending maps to an amber color', () => {
    expect(InvoiceStatusColor[InvoiceStatus.Pending]).toBe('#F59E0B');
  });

  it('Funded maps to a blue color', () => {
    expect(InvoiceStatusColor[InvoiceStatus.Funded]).toBe('#3B82F6');
  });

  it('Paid maps to a green color', () => {
    expect(InvoiceStatusColor[InvoiceStatus.Paid]).toBe('#10B981');
  });

  it('Defaulted maps to a red color', () => {
    expect(InvoiceStatusColor[InvoiceStatus.Defaulted]).toBe('#EF4444');
  });

  it('Disputed maps to a purple color', () => {
    expect(InvoiceStatusColor[InvoiceStatus.Disputed]).toBe('#8B5CF6');
  });
});

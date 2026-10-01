import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  parseCsvHeader,
  validateCsvHeaders,
  parseCsvRow,
  formatBatchErrorSummary,
} from './csvImport';

describe('parseCsvHeader', () => {
  it('splits and lowercases header columns', () => {
    expect(parseCsvHeader('Payer,Amount,Due_Date,Discount_Rate')).toEqual([
      'payer',
      'amount',
      'due_date',
      'discount_rate',
    ]);
  });

  it('trims whitespace and quotes', () => {
    expect(parseCsvHeader('"Payer" , "Amount"')).toEqual(['payer', 'amount']);
  });
});

describe('validateCsvHeaders', () => {
  it('returns empty for valid headers', () => {
    const errors = validateCsvHeaders(['payer', 'amount', 'due_date', 'discount_rate']);
    expect(errors).toHaveLength(0);
  });

  it('reports missing required columns', () => {
    const errors = validateCsvHeaders(['payer', 'amount']);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field === 'due_date')).toBe(true);
    expect(errors.some((e) => e.field === 'discount_rate')).toBe(true);
  });

  it('allows optional token column', () => {
    const errors = validateCsvHeaders(['payer', 'amount', 'due_date', 'discount_rate', 'token']);
    expect(errors).toHaveLength(0);
  });
});

describe('parseCsvRow', () => {
  const headers = ['payer', 'amount', 'due_date', 'discount_rate'];

  it('parses a valid row', () => {
    const result = parseCsvRow(
      ['GAaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeeefff', '100.50', '1800000000', '500'],
      headers,
      0
    );
    expect(result.errors).toHaveLength(0);
    expect(result.row.payer).toBe('GAaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeeefff');
    expect(result.row.amount).toBe(1005000000n);
    expect(result.row.dueDate).toBe(1800000000);
    expect(result.row.discountRate).toBe(500);
  });

  it('validates payer is a stellar address', () => {
    const result = parseCsvRow(['invalid', '100', '1800000000', '500'], headers, 0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].field).toBe('payer');
  });

  it('validates amount is positive', () => {
    const result = parseCsvRow(
      ['GAaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeeefff', '-5', '1800000000', '500'],
      headers,
      0
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].field).toBe('amount');
  });

  it('validates discount_rate is in range', () => {
    const result = parseCsvRow(
      ['GAaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeeefff', '100', '1800000000', '99999'],
      headers,
      0
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].field).toBe('discount_rate');
  });
});

describe('parseCsv', () => {
  const validCsv = [
    'payer,amount,due_date,discount_rate',
    'GAaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeeefff,250.00,1800000000,300',
    'GBbbbbbbbccccccccddddddddeeeeeeeeeefffffffffff,500.00,1800000100,500',
  ].join('\n');

  it('parses valid CSV content', () => {
    const result = parseCsv(validCsv);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].amount).toBe(2500000000n);
    expect(result.rows[1].discountRate).toBe(500);
  });

  it('rejects CSV with no header', () => {
    const result = parseCsv('');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.rows).toHaveLength(0);
  });

  it('reports row-level validation errors', () => {
    const csv = ['payer,amount,due_date,discount_rate', 'invalid,abc,not_a_date,not_a_number'].join(
      '\n'
    );
    const result = parseCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.rows).toHaveLength(0);
  });

  it('parses valid rows and collects errors for bad ones', () => {
    const csv = [
      'payer,amount,due_date,discount_rate',
      'GAaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeeefff,100,1800000000,300',
      'bad,50,1800000100,500',
    ].join('\n');
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('formatBatchErrorSummary', () => {
  it('groups errors by reason', () => {
    const results = [
      { index: 0, success: true },
      { index: 1, success: false, error: 'Insufficient balance' },
      { index: 2, success: false, error: 'Insufficient balance' },
      { index: 3, success: false, error: 'Invalid payer' },
    ];
    const summaries = formatBatchErrorSummary(results);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toContain('2 invoice(s)');
    expect(summaries[0]).toContain('Insufficient balance');
    expect(summaries[1]).toContain('Invalid payer');
  });

  it('returns empty array for all successes', () => {
    const results = [
      { index: 0, success: true },
      { index: 1, success: true },
    ];
    expect(formatBatchErrorSummary(results)).toHaveLength(0);
  });
});

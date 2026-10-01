import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db';

const EXPECTED_COLUMNS = {
  invoices: [
    'id',
    'freelancer',
    'payer',
    'amount',
    'due_date',
    'discount_rate',
    'status',
    'funder',
    'funded_at',
    'created_at',
    'updated_at',
  ],
  events: ['event_id', 'event_type', 'invoice_id', 'ledger', 'ledger_closed_at', 'created_at'],
  cursor: ['id', 'last_ledger', 'updated_at'],
};

describe('indexer database migrations', () => {
  // scripts/migrations contains Soroban contract upgrades, not SQLite schema
  // migrations. createDb/runMigrations is the definitive indexer schema path.
  it('migrates a fresh database to the schema expected by db.ts', () => {
    const db = createDb(':memory:');
    try {
      for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
        expect(columns.map(({ name }) => name)).toEqual(expected);
      }
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
        name: string;
      }[];
      expect(indexes.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          'idx_invoices_status',
          'idx_invoices_status_funder',
          'idx_events_invoice_id',
          'idx_events_ledger',
        ])
      );
    } finally {
      db.close();
    }
  });
});

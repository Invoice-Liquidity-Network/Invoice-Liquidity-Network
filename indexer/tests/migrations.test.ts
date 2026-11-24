import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createDb, SCHEMA_VERSION, applySchemaVersion, getSchemaVersion } from '../src/db';

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

  it('records the current schema version in the migration ledger', () => {
    const db = createDb(':memory:');
    try {
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
      const row = db
        .prepare('SELECT version, description FROM schema_migrations WHERE version = ?')
        .get(SCHEMA_VERSION) as { version: number; description: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.version).toBe(SCHEMA_VERSION);
      expect(row?.description).toContain('Initial schema');
    } finally {
      db.close();
    }
  });

  it('is idempotent: re-applying the schema version on an existing ledger is a no-op', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE schema_migrations (
          version     INTEGER PRIMARY KEY,
          applied_at  INTEGER NOT NULL,
          description TEXT    NOT NULL
        );
      `);
      applySchemaVersion(db, SCHEMA_VERSION, 'Initial schema');
      // Re-applying the same version must not duplicate the row.
      applySchemaVersion(db, SCHEMA_VERSION, 'Initial schema');
      const rows = db
        .prepare('SELECT COUNT(*) AS c FROM schema_migrations WHERE version = ?')
        .get(SCHEMA_VERSION) as { c: number };
      expect(rows.c).toBe(1);
    } finally {
      db.close();
    }
  });

  it('refuses to continue when the migration ledger is corrupt (version below recorded max)', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE schema_migrations (
          version     INTEGER PRIMARY KEY,
          applied_at  INTEGER NOT NULL,
          description TEXT    NOT NULL
        );
      `);
      // Pretend version 2 was applied, then someone drops the ledger back to 0.
      db.prepare(
        'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)'
      ).run(2, Date.now(), 'future migration');
      expect(() => applySchemaVersion(db, 1, 'rollback attempt')).toThrow(
        /below the highest recorded version/
      );
    } finally {
      db.close();
    }
  });

  it('refuses to skip versions in the migration ledger', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE schema_migrations (
          version     INTEGER PRIMARY KEY,
          applied_at  INTEGER NOT NULL,
          description TEXT    NOT NULL
        );
      `);
      db.prepare(
        'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)'
      ).run(1, Date.now(), 'v1');
      expect(() => applySchemaVersion(db, 5, 'gap')).toThrow(/skips versions/);
    } finally {
      db.close();
    }
  });
});

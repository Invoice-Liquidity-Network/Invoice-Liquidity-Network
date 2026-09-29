import type Database from 'better-sqlite3';
import type { HarnessMigration } from './types';

/**
 * Pending SQLite schema changes for the indexer, in the shape the harness
 * verifies. `scripts/migrations/*` cover contract upgrades; this registry is
 * the counterpart for indexer database schema work (see docs/migrations.md).
 */
export const MIGRATIONS: HarnessMigration[] = [
  {
    // The worked example from docs/migrations.md, as a real up/down pair.
    id: '001_add_invoice_expiry_column',
    description: 'Add invoice_expiry column to invoices table',
    up: (db: Database.Database) => {
      db.exec(`ALTER TABLE invoices ADD COLUMN invoice_expiry INTEGER DEFAULT 0`);
    },
    down: (db: Database.Database) => {
      db.exec(`ALTER TABLE invoices DROP COLUMN invoice_expiry`);
    },
    onlineStrategy: 'expand-contract',
  },
  {
    id: '002_add_events_ledger_covering_index',
    description: 'Add a (ledger, invoice_id) covering index on events for export ordering',
    up: (db: Database.Database) => {
      db.exec(`CREATE INDEX idx_events_ledger_invoice ON events(ledger, invoice_id)`);
    },
    down: (db: Database.Database) => {
      db.exec(`DROP INDEX idx_events_ledger_invoice`);
    },
    onlineStrategy: 'create-new-index-concurrently',
  },
];

/**
 * Deliberately budget-exceeding migration used ONLY as a test fixture
 * (full-table rewrite with no online strategy). Never registered for CI
 * checks — opt in via registryMigrations({ includeFixtures: true }) or the
 * `--fixtures` CLI flag.
 */
export const TEST_FIXTURE_MIGRATIONS: HarnessMigration[] = [
  {
    id: 'fixture_full_table_backfill',
    description: 'Test fixture: rewrites every invoice row, no online strategy (must fail budget)',
    up: (db: Database.Database) => {
      db.exec(`ALTER TABLE invoices ADD COLUMN fixture_backfilled INTEGER DEFAULT 0`);
      db.prepare(`UPDATE invoices SET fixture_backfilled = 1, updated_at = created_at`).run();
    },
    down: (db: Database.Database) => {
      db.exec(`ALTER TABLE invoices DROP COLUMN fixture_backfilled`);
    },
  },
];

export function registryMigrations(
  options: { includeFixtures?: boolean } = {}
): HarnessMigration[] {
  return options.includeFixtures ? [...MIGRATIONS, ...TEST_FIXTURE_MIGRATIONS] : [...MIGRATIONS];
}

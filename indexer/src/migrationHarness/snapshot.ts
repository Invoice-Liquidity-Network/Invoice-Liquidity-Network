import type Database from 'better-sqlite3';
import { createDb } from '../db';
import type { SnapshotScale } from './types';

/**
 * Projected mainnet row counts used when no explicit scale is given.
 * Estimated from testnet growth extrapolated to the mainnet launch target:
 * ~500k invoices and ~1.5M contract events at steady state.
 */
export const PROJECTED_MAINNET_SCALE: SnapshotScale = {
  invoices: 500_000,
  events: 1_500_000,
};

const BATCH_SIZE = 10_000;

/**
 * Bulk-insert production-shaped rows into an existing connection inside
 * transactional batches, mirroring how the live indexer writes.
 */
export function seedSnapshot(db: Database.Database, scale: SnapshotScale): void {
  const now = Date.now();
  const insertInvoice = db.prepare(
    `INSERT INTO invoices
       (id, freelancer, payer, amount, due_date, discount_rate, status, funder, funded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let start = 1; start <= scale.invoices; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, scale.invoices);
    db.transaction(() => {
      for (let id = start; id <= end; id++) {
        insertInvoice.run(
          id,
          `GFREELANCER${id % 5000}`,
          `GPAYER${id % 9000}`,
          String(100_000 + (id % 900_000)),
          1_800_000_000 + (id % 86_400),
          id % 1000,
          id % 4 === 0 ? 'Paid' : id % 3 === 0 ? 'Funded' : 'Pending',
          id % 5 === 0 ? `GFUNDER${id % 700}` : null,
          id % 5 === 0 ? now - 1000 : null,
          now - (id % 1_000_000),
          now
        );
      }
    })();
  }

  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO events
       (event_id, event_type, invoice_id, ledger, ledger_closed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const statuses = ['submitted', 'funded', 'paid', 'defaulted'] as const;
  for (let start = 1; start <= scale.events; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, scale.events);
    db.transaction(() => {
      for (let n = start; n <= end; n++) {
        insertEvent.run(
          `evt-${n}`,
          statuses[n % statuses.length],
          (n % scale.invoices) + 1,
          n,
          new Date(now - n).toISOString(),
          now - (n % 1_000_000)
        );
      }
    })();
  }
}

/**
 * Create a snapshot database at `path` (":memory:" for unit tests) using the
 * real `createDb` schema, seeded to `scale`.
 */
export function createSnapshotDb(
  path: string,
  scale: SnapshotScale = PROJECTED_MAINNET_SCALE
): Database.Database {
  const db = createDb(path);
  seedSnapshot(db, scale);
  return db;
}

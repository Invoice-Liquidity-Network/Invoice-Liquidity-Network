import type Database from 'better-sqlite3';

/**
 * A pending SQLite schema change verified by the migration harness.
 * `up`/`down` operate directly on a better-sqlite3 connection so the harness
 * can exercise them against a production-shaped snapshot.
 */
export interface HarnessMigration {
  id: string;
  description: string;
  up(db: Database.Database): void;
  down(db: Database.Database): void;
  /**
   * Name of the online approach (e.g. 'expand-contract',
   * 'create-new-index-concurrently') that makes the change safe to apply
   * while serving traffic. Required to pass budget checks when measured
   * runtime/lock time exceeds the configured budget.
   */
  onlineStrategy?: string;
}

/** Size of the production-shaped snapshot used for dry-runs. */
export interface SnapshotScale {
  invoices: number;
  events: number;
}

/** Measured cost of applying a migration to the snapshot. */
export interface MigrationMeasurement {
  id: string;
  /** Wall time of `up()` inside an exclusive transaction (ms). */
  runMs: number;
  /**
   * Lock-duration proxy: maximum latency a concurrent reader on a second
   * connection was kept waiting while the migration held its write lock (ms).
   */
  lockMs: number;
  /** Number of reads the concurrent reader completed during the run. */
  reads: number;
  /** Reads that surfaced SQLITE_BUSY to the concurrent reader. */
  busyReads: number;
}

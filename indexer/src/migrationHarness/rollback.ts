import type Database from 'better-sqlite3';
import { createDb } from '../db';
import { seedSnapshot } from './snapshot';
import type { HarnessMigration, SnapshotScale } from './types';

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface IndexInfoRow {
  name: string;
  unique: number;
  origin: string;
}

/**
 * Stable fingerprint of the current schema: column layout (PRAGMA table_info)
 * and indexes (PRAGMA index_list) for every user table. Used to prove a
 * migration's down path restores the exact prior schema.
 */
export function schemaFingerprint(db: Database.Database): string {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all() as { name: string }[];

  const fingerprint: Record<string, { columns: TableInfoRow[]; indexes: IndexInfoRow[] }> = {};
  for (const { name: table } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
    const indexes = (db.prepare(`PRAGMA index_list(${table})`).all() as IndexInfoRow[])
      // Filter implicit autoindexes so only named schema objects count.
      .filter((idx) => !idx.name.startsWith('sqlite_autoindex_'))
      .map(({ name, unique, origin }) => ({ name, unique, origin }))
      .sort((a, b) => a.name.localeCompare(b.name));
    fingerprint[table] = { columns, indexes };
  }
  return JSON.stringify(fingerprint);
}

export interface RollbackVerification {
  id: string;
  /** True when down() restores the exact pre-migration schema and up() is re-appliable. */
  ok: boolean;
  /** Fingerprints captured along the up → down → up walk (for failure diffs). */
  before: string;
  afterUp: string;
  afterDown: string;
  afterSecondUp: string;
  failure?: string;
}

/**
 * Prove a migration's down path actually works: apply up → down → up against
 * a snapshot (in-memory by default) and assert schema equality at each
 * round-trip via PRAGMA table_info / index_list fingerprints.
 */
export function verifyRollback(
  migration: HarnessMigration,
  options: { scale?: SnapshotScale; dbPath?: string } = {}
): RollbackVerification {
  const db = createDb(options.dbPath ?? ':memory:');
  try {
    seedSnapshot(db, options.scale ?? { invoices: 200, events: 400 });
    return walkUpDown(migration, db);
  } finally {
    db.close();
  }
}

function walkUpDown(migration: HarnessMigration, db: Database.Database): RollbackVerification {
  const before = schemaFingerprint(db);
  let afterUp = '';
  let afterDown = '';
  let afterSecondUp = '';

  try {
    migration.up(db);
    afterUp = schemaFingerprint(db);
    migration.down(db);
    afterDown = schemaFingerprint(db);
    migration.up(db);
    afterSecondUp = schemaFingerprint(db);
  } catch (err) {
    return {
      id: migration.id,
      ok: false,
      before,
      afterUp,
      afterDown,
      afterSecondUp,
      failure: err instanceof Error ? err.message : String(err),
    };
  }

  const failures: string[] = [];
  if (afterDown !== before) {
    failures.push('down() did not restore the pre-migration schema');
  }
  if (afterSecondUp !== afterUp) {
    failures.push('re-applying up() after rollback produced a different schema');
  }
  if (afterUp === before) {
    failures.push('up() did not change the schema — the migration is a no-op');
  }

  return {
    id: migration.id,
    ok: failures.length === 0,
    before,
    afterUp,
    afterDown,
    afterSecondUp,
    failure: failures.length > 0 ? failures.join('; ') : undefined,
  };
}

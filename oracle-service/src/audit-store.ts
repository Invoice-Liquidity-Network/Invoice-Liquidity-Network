/**
 * oracle-service/src/audit-store.ts
 *
 * Persistence layer for the oracle audit trail (issue #1055).
 *
 * Two implementations of `AuditRowStore` are provided:
 *  - `SqliteAuditStore` — durable, the production driver (the same engine the
 *    notifications and indexer services use);
 *  - `MemoryAuditStore` — ephemeral, for tests and local development.
 *
 * The store deliberately knows *nothing* about hashing, HMACs, or the chain: it
 * persists rows and the one signed anchor record the trail needs. Keeping
 * tamper-detection logic out of the persistence layer is what lets
 * `AuditTrail.verifyIntegrity()` treat the store as untrusted input — a driver
 * that returns forged, reordered, or deleted rows is detected rather than
 * believed.
 */

import { createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

/**
 * One published verdict, exactly as persisted.
 *
 * `payload` is the canonical JSON of the audit entry and the only thing the
 * chain hashes. The leading columns are *projections* of values inside
 * `payload`, kept only so range and payer queries can use an index. Because
 * they are duplicates, they can be edited without touching `payload` — which is
 * why integrity verification re-checks every projection against the payload it
 * claims to mirror.
 */
export interface AuditRow {
  seq: number;
  generatedAt: string;
  payer: string;
  invoiceId: string;
  amount: string;
  isVerified: boolean;
  trustScore: number;
  outcome: string;
  hash: string;
  payload: string;
}

/**
 * Signed proof of what a retention purge legitimately removed, so the chain can
 * be verified from a point in the middle and "delete the oldest rows to hide an
 * edit" is detectable instead of silent.
 */
export interface AuditAnchorRecord {
  seq: number;
  hash: string;
  purgedThrough: number;
  purgedAt: string;
  /** HMAC produced by the trail; the store only persists it. */
  signature: string;
}

export interface AuditRowFilter {
  /** Inclusive ISO-8601 lower bound on `generatedAt`. */
  from?: string;
  /** Inclusive ISO-8601 upper bound on `generatedAt`. */
  to?: string;
  payer?: string;
  invoiceId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditRowStore {
  /**
   * Declared by the implementation rather than inferred from configuration, so
   * health reporting cannot claim a durability guarantee it does not have.
   */
  readonly kind: 'sqlite' | 'memory';
  /** Newest row, or null when the store holds none. */
  lastRow(): Promise<AuditRow | null>;
  /** All rows with `seq > afterSeq`, ascending. Used by integrity walks. */
  rowsAfter(afterSeq: number): Promise<AuditRow[]>;
  /** Fails if `row.seq` is already taken — the trail never overwrites history. */
  insert(row: AuditRow): Promise<void>;
  query(filter: AuditRowFilter): Promise<AuditRow[]>;
  /**
   * Rows matching `filter`, ignoring its `limit`/`offset`.
   *
   * The filter matters: a caller paging through one payer's year of history has
   * to be able to tell when the page ran out, and a whole-table count would
   * always say there was more.
   */
  count(filter?: AuditRowFilter): Promise<number>;
  /** Delete every row with `seq <= throughSeq`. Returns the number deleted. */
  deleteThrough(throughSeq: number): Promise<number>;
  getAnchor(): Promise<AuditAnchorRecord | null>;
  setAnchor(anchor: AuditAnchorRecord): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function bySequence(a: AuditRow, b: AuditRow): number {
  return a.seq - b.seq;
}

function matchesFilter(row: AuditRow, filter: AuditRowFilter): boolean {
  if (filter.from && row.generatedAt < filter.from) return false;
  if (filter.to && row.generatedAt > filter.to) return false;
  if (filter.payer && row.payer !== filter.payer) return false;
  if (filter.invoiceId && row.invoiceId !== filter.invoiceId) return false;
  return true;
}

// ---------------------------------------------------------------------------
// MemoryAuditStore
// ---------------------------------------------------------------------------

/**
 * Ephemeral store. Rows are frozen on write so a caller cannot rewrite the
 * trail through an object it received back — the SQLite driver gets that
 * guarantee from serialisation, and this driver must not be the weaker one.
 */
export class MemoryAuditStore implements AuditRowStore {
  readonly kind = 'memory' as const;

  private readonly rows = new Map<number, AuditRow>();
  private anchor: AuditAnchorRecord | null = null;

  async lastRow(): Promise<AuditRow | null> {
    let newest: AuditRow | null = null;
    for (const row of this.rows.values()) {
      if (!newest || row.seq > newest.seq) newest = row;
    }
    return newest ? { ...newest } : null;
  }

  async rowsAfter(afterSeq: number): Promise<AuditRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.seq > afterSeq)
      .sort(bySequence)
      .map((row) => ({ ...row }));
  }

  async insert(row: AuditRow): Promise<void> {
    if (this.rows.has(row.seq)) {
      throw new Error(`MemoryAuditStore: row ${row.seq} already exists`);
    }
    this.rows.set(row.seq, Object.freeze({ ...row }));
  }

  async query(filter: AuditRowFilter): Promise<AuditRow[]> {
    const matched = [...this.rows.values()]
      .filter((row) => matchesFilter(row, filter))
      .sort(bySequence);
    const start = filter.offset ?? 0;
    const end = filter.limit === undefined ? undefined : start + filter.limit;
    return matched.slice(start, end).map((row) => ({ ...row }));
  }

  async count(filter: AuditRowFilter = {}): Promise<number> {
    const matched = [...this.rows.values()].filter((row) => matchesFilter(row, filter));
    return matched.length;
  }

  async deleteThrough(throughSeq: number): Promise<number> {
    let deleted = 0;
    for (const seq of [...this.rows.keys()]) {
      if (seq <= throughSeq) {
        this.rows.delete(seq);
        deleted += 1;
      }
    }
    return deleted;
  }

  async getAnchor(): Promise<AuditAnchorRecord | null> {
    return this.anchor ? { ...this.anchor } : null;
  }

  async setAnchor(anchor: AuditAnchorRecord): Promise<void> {
    this.anchor = { ...anchor };
  }

  async close(): Promise<void> {
    this.rows.clear();
    this.anchor = null;
  }
}

// ---------------------------------------------------------------------------
// SqliteAuditStore
// ---------------------------------------------------------------------------

/**
 * The subset of `better-sqlite3`'s `Database` this store uses. Declared locally
 * instead of importing the package's types so oracle-service keeps compiling on
 * a Node version the native module was not built for.
 */
export interface SqliteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabaseLike {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

const AUDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_entries (
  seq           INTEGER PRIMARY KEY,
  generated_at  TEXT    NOT NULL,
  payer         TEXT    NOT NULL,
  invoice_id    TEXT    NOT NULL,
  amount        TEXT    NOT NULL,
  is_verified   INTEGER NOT NULL,
  trust_score   REAL    NOT NULL,
  outcome       TEXT    NOT NULL,
  hash          TEXT    NOT NULL,
  payload       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_generated_at ON audit_entries (generated_at);
CREATE INDEX IF NOT EXISTS idx_audit_payer_time   ON audit_entries (payer, generated_at);
CREATE INDEX IF NOT EXISTS idx_audit_invoice      ON audit_entries (invoice_id);

-- Holds exactly the signed retention anchor. Separate from the entries table
-- because it must survive a purge and be provable independently of it.
CREATE TABLE IF NOT EXISTS audit_anchor (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  seq           INTEGER NOT NULL,
  hash          TEXT    NOT NULL,
  purged_through INTEGER NOT NULL,
  purged_at     TEXT    NOT NULL,
  signature     TEXT    NOT NULL
);
`;

interface AuditRowDbShape {
  seq: number;
  generated_at: string;
  payer: string;
  invoice_id: string;
  amount: string;
  is_verified: number;
  trust_score: number;
  outcome: string;
  hash: string;
  payload: string;
}

interface AuditAnchorDbShape {
  seq: number;
  hash: string;
  purged_through: number;
  purged_at: string;
  signature: string;
}

function toRow(record: AuditRowDbShape): AuditRow {
  return {
    seq: Number(record.seq),
    generatedAt: record.generated_at,
    payer: record.payer,
    invoiceId: record.invoice_id,
    amount: record.amount,
    isVerified: record.is_verified === 1,
    trustScore: Number(record.trust_score),
    outcome: record.outcome,
    hash: record.hash,
    payload: record.payload,
  };
}

/**
 * WHERE clause shared by the paged read and its matching count.
 *
 * Anonymous placeholders, with the optional filters written as `? = '' OR col = ?`
 * so the parameter list stays fixed. Numbered `?1` parameters are the
 * alternative, but better-sqlite3 treats them as *named* ones and refuses to
 * bind them positionally — and a filter that cannot be expressed without a
 * branch would put SQL injection into the audit read path, which is the last
 * place that deserves it.
 *
 * Defined once rather than per statement: a count whose predicates drifted from
 * the page it describes would report a total the returned rows do not match.
 */
const AUDIT_FILTER_WHERE = `
   WHERE (? = '' OR generated_at >= ?)
     AND (? = '' OR generated_at <= ?)
     AND (? = '' OR payer = ?)
     AND (? = '' OR invoice_id = ?)`;

/** Positional parameters for {@link AUDIT_FILTER_WHERE}; each value bound twice. */
function filterParams(filter: AuditRowFilter): unknown[] {
  const from = filter.from ?? '';
  const to = filter.to ?? '';
  const payer = filter.payer ?? '';
  const invoiceId = filter.invoiceId ?? '';
  return [from, from, to, to, payer, payer, invoiceId, invoiceId];
}

/**
 * Durable SQLite-backed store.
 *
 * `db` is injectable so the SQL mapping can be driven by a test double; the
 * default opens `path` through `better-sqlite3`.
 */
export class SqliteAuditStore implements AuditRowStore {
  readonly kind = 'sqlite' as const;

  private readonly db: SqliteDatabaseLike;
  private readonly statements: {
    insert: SqliteStatement;
    last: SqliteStatement;
    after: SqliteStatement;
    select: SqliteStatement;
    count: SqliteStatement;
    deleteThrough: SqliteStatement;
    readAnchor: SqliteStatement;
    writeAnchor: SqliteStatement;
  };

  constructor(opts: { path?: string; db?: SqliteDatabaseLike } = {}) {
    if (opts.db) {
      this.db = opts.db;
    } else {
      const path = opts.path ?? process.env.ORACLE_AUDIT_DB_PATH;
      if (!path) {
        throw new Error(
          'SqliteAuditStore: either `path` (or ORACLE_AUDIT_DB_PATH) or `db` is required'
        );
      }
      this.db = openSqliteDatabase(path);
    }

    this.db.exec(AUDIT_SCHEMA);

    this.statements = {
      insert: this.db.prepare(`
        INSERT INTO audit_entries
          (seq, generated_at, payer, invoice_id, amount, is_verified, trust_score, outcome, hash, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      last: this.db.prepare('SELECT * FROM audit_entries ORDER BY seq DESC LIMIT 1'),
      after: this.db.prepare('SELECT * FROM audit_entries WHERE seq > ? ORDER BY seq ASC'),
      select: this.db.prepare(`
        SELECT * FROM audit_entries${AUDIT_FILTER_WHERE}
         ORDER BY seq ASC
         LIMIT ? OFFSET ?
      `),
      count: this.db.prepare(`SELECT COUNT(*) AS total FROM audit_entries${AUDIT_FILTER_WHERE}`),
      deleteThrough: this.db.prepare('DELETE FROM audit_entries WHERE seq <= ?'),
      readAnchor: this.db.prepare('SELECT * FROM audit_anchor WHERE id = 1'),
      writeAnchor: this.db.prepare(`
        INSERT INTO audit_anchor (id, seq, hash, purged_through, purged_at, signature)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          seq = excluded.seq,
          hash = excluded.hash,
          purged_through = excluded.purged_through,
          purged_at = excluded.purged_at,
          signature = excluded.signature
      `),
    };
  }

  async lastRow(): Promise<AuditRow | null> {
    const row = this.statements.last.get() as AuditRowDbShape | undefined;
    return row ? toRow(row) : null;
  }

  async rowsAfter(afterSeq: number): Promise<AuditRow[]> {
    return (this.statements.after.all(afterSeq) as AuditRowDbShape[]).map(toRow);
  }

  async insert(row: AuditRow): Promise<void> {
    this.statements.insert.run(
      row.seq,
      row.generatedAt,
      row.payer,
      row.invoiceId,
      row.amount,
      row.isVerified ? 1 : 0,
      row.trustScore,
      row.outcome,
      row.hash,
      row.payload
    );
  }

  async query(filter: AuditRowFilter): Promise<AuditRow[]> {
    const rows = this.statements.select.all(
      ...filterParams(filter),
      // SQLite treats a negative LIMIT as "no limit".
      filter.limit ?? -1,
      filter.offset ?? 0
    ) as AuditRowDbShape[];
    return rows.map(toRow);
  }

  async count(filter: AuditRowFilter = {}): Promise<number> {
    const row = this.statements.count.get(...filterParams(filter)) as { total: number } | undefined;
    return Number(row?.total ?? 0);
  }

  async deleteThrough(throughSeq: number): Promise<number> {
    return this.statements.deleteThrough.run(throughSeq).changes;
  }

  async getAnchor(): Promise<AuditAnchorRecord | null> {
    const row = this.statements.readAnchor.get() as AuditAnchorDbShape | undefined;
    if (!row) return null;
    return {
      seq: Number(row.seq),
      hash: row.hash,
      purgedThrough: Number(row.purged_through),
      purgedAt: row.purged_at,
      signature: row.signature,
    };
  }

  async setAnchor(anchor: AuditAnchorRecord): Promise<void> {
    this.statements.writeAnchor.run(
      anchor.seq,
      anchor.hash,
      anchor.purgedThrough,
      anchor.purgedAt,
      anchor.signature
    );
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/**
 * Load `better-sqlite3` lazily.
 *
 * The indirection is deliberate: oracle-service also runs where the native
 * module was never built for the active Node ABI, and the memory driver must
 * stay loadable there. Misconfiguration surfaces as an actionable error at
 * construction time rather than a crash at import time.
 */
function openSqliteDatabase(path: string): SqliteDatabaseLike {
  let Database: new (file: string) => SqliteDatabaseLike;
  try {
    const requireModule = createRequire(import.meta.url);
    Database = requireModule('better-sqlite3') as new (file: string) => SqliteDatabaseLike;
    // Constructing is what actually loads the native binding: requiring the
    // package succeeds even on a Node version it was never built for.
    const db = new Database(path);
    // WAL keeps integrity scans and audit queries from blocking appends.
    db.exec('PRAGMA journal_mode = WAL;');
    return db;
  } catch (error) {
    throw new Error(
      `SqliteAuditStore: better-sqlite3 could not open "${path}" (` +
        `${error instanceof Error ? error.message : String(error)}). ` +
        'Build the native module for this Node version, or set ORACLE_AUDIT_DRIVER=memory ' +
        'only where losing the trail on restart is acceptable.'
    );
  }
}

// ---------------------------------------------------------------------------
// Driver resolution
// ---------------------------------------------------------------------------

export interface CreateAuditStoreOptions {
  driver?: 'sqlite' | 'memory';
  path?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the audit driver from options / environment.
 *
 * A database path implies the durable driver; its absence implies memory so
 * tests and local development keep working. In production the ephemeral driver
 * is refused outright — a trail that loses its contents on restart cannot honour
 * the retention window it advertises, so it must fail loudly at boot instead of
 * quietly under-recording.
 */
export async function createAuditStore(opts: CreateAuditStoreOptions = {}): Promise<AuditRowStore> {
  const env = opts.env ?? process.env;
  const path = opts.path ?? env.ORACLE_AUDIT_DB_PATH;
  const driver: string = opts.driver ?? env.ORACLE_AUDIT_DRIVER ?? (path ? 'sqlite' : 'memory');

  if (driver === 'memory') {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'createAuditStore: ORACLE_AUDIT_DRIVER=memory is not allowed in production. ' +
          'Set ORACLE_AUDIT_DB_PATH to a durable SQLite file — an audit trail that ' +
          'does not survive restart cannot support incident forensics or the 1-year retention window.'
      );
    }
    return new MemoryAuditStore();
  }

  if (driver !== 'sqlite') {
    throw new Error(
      `createAuditStore: unknown ORACLE_AUDIT_DRIVER "${driver}" (expected "sqlite" or "memory")`
    );
  }

  if (!path) {
    throw new Error(
      'createAuditStore: ORACLE_AUDIT_DB_PATH is required for the sqlite audit driver'
    );
  }
  return new SqliteAuditStore({ path });
}

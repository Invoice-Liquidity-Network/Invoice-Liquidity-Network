/**
 * oracle-service/src/audit-store.test.ts  (issue #1055)
 *
 * Both drivers must behave identically, because `AuditTrail` reasons about the
 * chain on top of whichever one is configured — a store that silently drops a
 * filter or reorders rows would make a tampered trail look intact.
 *
 * So the same conformance suite runs against the memory driver and against the
 * real SQL, which is executed through `node:sqlite` where available and through
 * `better-sqlite3` otherwise. That keeps the SQL statements themselves under
 * test rather than only type-checked: the projection columns, the `?N`
 * positional filters, and the anchor upsert are exactly where a durable driver
 * can differ from an in-memory one.
 */

import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MemoryAuditStore,
  SqliteAuditStore,
  createAuditStore,
  type AuditAnchorRecord,
  type AuditRow,
  type AuditRowStore,
  type SqliteDatabaseLike,
} from './audit-store';

// ---------------------------------------------------------------------------
// Real SQLite, whichever way the runtime offers it
// ---------------------------------------------------------------------------

interface NodeSqliteDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  close(): void;
}

/**
 * Resolve a real SQLite engine without a compile-time dependency on either
 * module: `better-sqlite3` needs a native build matched to the running ABI, and
 * `node:sqlite` only exists from Node 22.5. A fresh handle per call keeps each
 * test isolated.
 */
function openSqliteHandle(): SqliteDatabaseLike | null {
  const requireModule = createRequire(import.meta.url);

  try {
    const Database = requireModule('better-sqlite3') as new (file: string) => SqliteDatabaseLike;
    return new Database(':memory:');
  } catch {
    // Fall through to the built-in driver.
  }

  try {
    const { DatabaseSync } = requireModule('node:' + 'sqlite') as {
      DatabaseSync: new (file: string) => NodeSqliteDatabase;
    };
    const db = new DatabaseSync(':memory:');
    return {
      prepare: (sql: string) => db.prepare(sql),
      exec: (sql: string) => db.exec(sql),
      close: () => db.close(),
    };
  } catch {
    return null;
  }
}

/** Whether the SQL statements can be executed at all in this runtime. */
const hasRealSqlite = openSqliteHandle() !== null;
/** Whether a `better-sqlite3` build for this ABI exists (needed for file paths). */
const hasNativeSqlite = (() => {
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3') as new (
      file: string
    ) => SqliteDatabaseLike;
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAYER_A = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const PAYER_B = 'GCPAYERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function makeRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    seq: 1,
    generatedAt: '2024-06-01T00:00:00.000Z',
    payer: PAYER_A,
    invoiceId: '42',
    amount: '10000000',
    isVerified: true,
    trustScore: 88,
    outcome: 'verified-heuristic-only',
    hash: 'a'.repeat(64),
    payload: '{"content":{}}',
    ...overrides,
  };
}

function makeAnchor(overrides: Partial<AuditAnchorRecord> = {}): AuditAnchorRecord {
  return {
    seq: 7,
    hash: 'b'.repeat(64),
    purgedThrough: 7,
    purgedAt: '2025-06-01T00:00:00.000Z',
    signature: 'c'.repeat(64),
    ...overrides,
  };
}

const DRIVERS: Array<[label: string, create: () => AuditRowStore]> = [
  ['memory', () => new MemoryAuditStore()],
  ...(hasRealSqlite
    ? ([['sqlite', () => new SqliteAuditStore({ db: openSqliteHandle()! })]] as Array<
        [string, () => AuditRowStore]
      >)
    : []),
];

// ---------------------------------------------------------------------------
// Conformance suite — identical expectations for both drivers
// ---------------------------------------------------------------------------

describe.each(DRIVERS)('AuditRowStore conformance (%s)', (_label, create) => {
  it('starts empty', async () => {
    const store = create();
    expect(await store.lastRow()).toBeNull();
    expect(await store.count()).toBe(0);
    expect(await store.rowsAfter(0)).toEqual([]);
    expect(await store.getAnchor()).toBeNull();
  });

  it('reports the newest row rather than the last inserted', async () => {
    const store = create();
    await store.insert(makeRow({ seq: 1 }));
    await store.insert(makeRow({ seq: 3, generatedAt: '2024-07-01T00:00:00.000Z' }));
    await store.insert(makeRow({ seq: 2, generatedAt: '2024-06-15T00:00:00.000Z' }));

    expect((await store.lastRow())?.seq).toBe(3);
  });

  it('returns rows after a sequence number, in ascending order', async () => {
    const store = create();
    for (const seq of [3, 1, 2, 4]) await store.insert(makeRow({ seq }));

    expect((await store.rowsAfter(1)).map((row) => row.seq)).toEqual([2, 3, 4]);
  });

  it('round-trips every column, including the boolean projection', async () => {
    const store = create();
    const row = makeRow({ isVerified: false, trustScore: 41.5, outcome: 'rejected-fraud-signals' });
    await store.insert(row);

    expect(await store.lastRow()).toEqual(row);
  });

  it('filters by an inclusive time range', async () => {
    const store = create();
    await store.insert(makeRow({ seq: 1, generatedAt: '2024-01-01T00:00:00.000Z' }));
    await store.insert(makeRow({ seq: 2, generatedAt: '2024-06-01T00:00:00.000Z' }));
    await store.insert(makeRow({ seq: 3, generatedAt: '2024-12-01T00:00:00.000Z' }));

    const window = await store.query({
      from: '2024-06-01T00:00:00.000Z',
      to: '2024-06-01T00:00:00.000Z',
    });
    expect(window.map((row) => row.seq)).toEqual([2]);
  });

  it('filters by payer and by invoice independently and together', async () => {
    const store = create();
    await store.insert(makeRow({ seq: 1, payer: PAYER_A, invoiceId: '1' }));
    await store.insert(makeRow({ seq: 2, payer: PAYER_B, invoiceId: '1' }));
    await store.insert(makeRow({ seq: 3, payer: PAYER_A, invoiceId: '2' }));

    expect((await store.query({ payer: PAYER_A })).map((r) => r.seq)).toEqual([1, 3]);
    expect((await store.query({ invoiceId: '1' })).map((r) => r.seq)).toEqual([1, 2]);
    expect((await store.query({ payer: PAYER_A, invoiceId: '2' })).map((r) => r.seq)).toEqual([3]);
  });

  it('pages results in sequence order', async () => {
    const store = create();
    for (const seq of [1, 2, 3, 4, 5]) await store.insert(makeRow({ seq }));

    expect((await store.query({ limit: 2, offset: 2 })).map((r) => r.seq)).toEqual([3, 4]);
    expect((await store.query({ limit: 2 })).map((r) => r.seq)).toEqual([1, 2]);
    expect((await store.query({})).map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('counts the rows a filter matches, not the rows that page was asked for', async () => {
    const store = create();
    await store.insert(makeRow({ seq: 1, payer: PAYER_A, invoiceId: '1' }));
    await store.insert(makeRow({ seq: 2, payer: PAYER_B, invoiceId: '1' }));
    await store.insert(makeRow({ seq: 3, payer: PAYER_A, invoiceId: '2' }));

    // The whole store.
    expect(await store.count()).toBe(3);
    // A caller paging with limit 1 needs the filtered total to know when to stop.
    expect(await store.count({ payer: PAYER_A })).toBe(2);
    expect(await store.count({ invoiceId: '1' })).toBe(2);
    expect(await store.count({ payer: PAYER_A, invoiceId: '2' })).toBe(1);
    expect(await store.count({ payer: PAYER_B, invoiceId: '2' })).toBe(0);
    expect(await store.count({ to: '2024-06-01T00:00:00.000Z' })).toBe(
      (await store.query({ to: '2024-06-01T00:00:00.000Z' })).length
    );
    // Paging narrows the page, never the total behind it.
    expect(await store.count({ payer: PAYER_A, limit: 1, offset: 5 })).toBe(2);
  });

  it('refuses to overwrite an existing sequence number', async () => {
    const store = create();
    await store.insert(makeRow({ seq: 1 }));

    await expect(store.insert(makeRow({ seq: 1, payer: PAYER_B }))).rejects.toThrow();
  });

  it('deletes only through the given sequence number', async () => {
    const store = create();
    for (const seq of [1, 2, 3, 4]) await store.insert(makeRow({ seq }));

    expect(await store.deleteThrough(2)).toBe(2);
    expect((await store.rowsAfter(0)).map((row) => row.seq)).toEqual([3, 4]);
    expect(await store.count()).toBe(2);
  });

  it('keeps a single anchor row and overwrites it in place', async () => {
    const store = create();
    await store.setAnchor(makeAnchor({ seq: 1 }));
    await store.setAnchor(makeAnchor({ seq: 9 }));

    expect(await store.getAnchor()).toEqual(makeAnchor({ seq: 9 }));
  });

  it('gives each store its own empty dataset', async () => {
    const first = create();
    await first.insert(makeRow({ seq: 1 }));

    expect(await create().count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Durability, specifically
// ---------------------------------------------------------------------------

describe('SqliteAuditStore durability', () => {
  it.skipIf(!hasNativeSqlite)('keeps rows for a second store opened on the same file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iln-audit-'));
    const file = join(dir, 'trail.sqlite');

    const first = new SqliteAuditStore({ path: file });
    await first.insert(makeRow({ seq: 1 }));
    await first.insert(makeRow({ seq: 2 }));
    await first.setAnchor(makeAnchor());
    await first.close();

    const reopened = new SqliteAuditStore({ path: file });
    expect(await reopened.count()).toBe(2);
    expect((await reopened.lastRow())?.seq).toBe(2);
    expect(await reopened.getAnchor()).toEqual(makeAnchor());
    await reopened.close();
  });

  it('demands either a path or an injected handle', () => {
    expect(() => new SqliteAuditStore({})).toThrow(/is required/);
  });

  it.skipIf(!hasNativeSqlite)(
    'fails loudly when the configured database file cannot be opened',
    () => {
      // A typo in ORACLE_AUDIT_DB_PATH must stop the service at boot. Falling
      // back to an in-memory trail would advertise durability it does not have.
      const missing = join(tmpdir(), 'iln-audit-no-such-directory', 'trail.sqlite');

      expect(() => new SqliteAuditStore({ path: missing })).toThrow(
        new RegExp(`could not open "${missing.replace(/[\\/:.*+?^${}()|[\]]/g, '\\$&')}"`)
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Driver resolution
// ---------------------------------------------------------------------------

describe('createAuditStore', () => {
  it('defaults to memory when no database path is configured', async () => {
    const store = await createAuditStore({ env: {} });
    expect(store.kind).toBe('memory');
  });

  it('honours an explicit memory driver', async () => {
    const store = await createAuditStore({ env: {}, driver: 'memory' });
    expect(store.kind).toBe('memory');
  });

  it('selects sqlite once a database path is configured', async () => {
    const attempt = createAuditStore({
      env: { ORACLE_AUDIT_DB_PATH: '/tmp/iln-audit-test.sqlite' },
    });
    if (hasNativeSqlite) {
      expect((await attempt).kind).toBe('sqlite');
      return;
    }
    // Without a native build the resolution must still have taken the durable
    // branch — failing loudly is the point, never a silent memory fallback.
    await expect(attempt).rejects.toThrow(/better-sqlite3 could not open/);
  });

  it('refuses to run production on an ephemeral trail', async () => {
    await expect(
      createAuditStore({ env: { NODE_ENV: 'production' }, driver: 'memory' })
    ).rejects.toThrow(/not allowed in production/);
  });

  it('requires a path when the durable driver is selected', async () => {
    await expect(createAuditStore({ env: { ORACLE_AUDIT_DRIVER: 'sqlite' } })).rejects.toThrow(
      /ORACLE_AUDIT_DB_PATH is required/
    );
  });

  it('rejects an unknown driver instead of quietly picking one', async () => {
    await expect(createAuditStore({ env: { ORACLE_AUDIT_DRIVER: 'postgres' } })).rejects.toThrow(
      /unknown ORACLE_AUDIT_DRIVER/
    );
  });
});

// ---------------------------------------------------------------------------
// Memory driver specifics
// ---------------------------------------------------------------------------

describe('MemoryAuditStore', () => {
  it('hands out copies so a caller cannot rewrite stored rows', async () => {
    const store = new MemoryAuditStore();
    await store.insert(makeRow({ seq: 1 }));

    const rows = await store.query({});
    (rows[0] as { payer: string }).payer = PAYER_B;

    expect((await store.lastRow())?.payer).toBe(PAYER_A);
  });

  it('drops everything on close', async () => {
    const store = new MemoryAuditStore();
    await store.insert(makeRow({ seq: 1 }));
    await store.setAnchor(makeAnchor());
    await store.close();

    expect(await store.count()).toBe(0);
    expect(await store.getAnchor()).toBeNull();
  });
});

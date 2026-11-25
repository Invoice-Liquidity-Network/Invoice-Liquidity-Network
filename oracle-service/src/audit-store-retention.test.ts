import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  MemoryAuditStore,
  SqliteAuditStore,
  type AuditRow,
  type AdminAuditRecord,
  type AuditAnchorRecord,
  type SqliteDatabaseLike,
} from './audit-store';

interface NodeSqliteDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  close(): void;
}

function openSqliteHandle(): SqliteDatabaseLike | null {
  const requireModule = createRequire(import.meta.url);

  try {
    const Database = requireModule('better-sqlite3') as new (file: string) => SqliteDatabaseLike;
    return new Database(':memory:');
  } catch {
    // Fall through to node:sqlite
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

function makeRow(seq: number, generatedAt = new Date().toISOString()): AuditRow {
  return {
    seq,
    generatedAt,
    payer: 'GDVEU3DDTESTPAYER',
    invoiceId: `inv-${seq}`,
    amount: '1000',
    isVerified: true,
    trustScore: 85,
    outcome: 'verified',
    hash: `hash-${seq}`,
    payload: JSON.stringify({ seq, test: true }),
  };
}

describe.each([
  {
    name: 'MemoryAuditStore',
    create: async () => new MemoryAuditStore(),
  },
  {
    name: 'SqliteAuditStore',
    create: async () => {
      const db = openSqliteHandle();
      if (!db) {
        throw new Error('No SQLite driver available in test environment');
      }
      return new SqliteAuditStore({ db });
    },
  },
])('Audit store retention and admin traceability ($name) (#1485)', ({ create }) => {
  it('prunes expired rows while preserving administrative provenance records', async () => {
    const store = await create();

    // 1. Insert 5 verification rows
    for (let i = 1; i <= 5; i++) {
      await store.insert(makeRow(i));
    }
    expect(await store.count()).toBe(5);

    // 2. Record administrative action (e.g., source configuration change)
    const adminRecord: AdminAuditRecord = {
      id: 'adm-001',
      action: 'source_config_change',
      actor: 'admin:secops',
      details: JSON.stringify({ primary: 'kyb-vendor-a', fallback: 'kyb-vendor-b' }),
      timestamp: '2026-01-15T12:00:00.000Z',
      signature: 'hmac-sig-adm-001',
    };
    await store.recordAdminAction!(adminRecord);
    expect(await store.countAdminActions!()).toBe(1);

    // 3. Purge rows 1 through 3
    const deleted = await store.deleteThrough(3);
    expect(deleted).toBe(3);

    // 4. Verification rows remaining should be rows 4 and 5
    expect(await store.count()).toBe(2);
    const remaining = await store.rowsAfter(0);
    expect(remaining.map((r) => r.seq)).toEqual([4, 5]);

    // 5. Admin provenance record MUST still be intact and queryable!
    const adminActions = await store.getAdminActions!();
    expect(adminActions).toHaveLength(1);
    expect(adminActions[0].id).toBe('adm-001');
    expect(adminActions[0].action).toBe('source_config_change');
    expect(adminActions[0].actor).toBe('admin:secops');

    await store.close();
  });

  it('persists and updates anchor records with adminStateHash', async () => {
    const store = await create();

    const anchor: AuditAnchorRecord = {
      seq: 10,
      hash: 'sha256-hash-at-10',
      purgedThrough: 10,
      purgedAt: new Date().toISOString(),
      signature: 'hmac-anchor-signature',
      adminStateHash: 'sha256-admin-state-hash',
    };

    await store.setAnchor(anchor);

    const retrieved = await store.getAnchor();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.seq).toBe(10);
    expect(retrieved?.purgedThrough).toBe(10);
    expect(retrieved?.adminStateHash).toBe('sha256-admin-state-hash');

    await store.close();
  });

  it('filters admin provenance records by action, actor, and time range', async () => {
    const store = await create();

    await store.recordAdminAction!({
      id: 'act-1',
      action: 'source_config_change',
      actor: 'operator-alice',
      details: 'added fallback indexer',
      timestamp: '2026-03-01T10:00:00.000Z',
    });

    await store.recordAdminAction!({
      id: 'act-2',
      action: 'key_rotation',
      actor: 'operator-bob',
      details: 'rotated signing key',
      timestamp: '2026-03-05T10:00:00.000Z',
    });

    await store.recordAdminAction!({
      id: 'act-3',
      action: 'retention_policy_change',
      actor: 'operator-alice',
      details: 'updated retention window to 365d',
      timestamp: '2026-03-10T10:00:00.000Z',
    });

    // Filter by actor
    const aliceActions = await store.getAdminActions!({ actor: 'operator-alice' });
    expect(aliceActions).toHaveLength(2);

    // Filter by action
    const keyRotations = await store.getAdminActions!({ action: 'key_rotation' });
    expect(keyRotations).toHaveLength(1);
    expect(keyRotations[0].actor).toBe('operator-bob');

    // Filter by time range
    const rangeActions = await store.getAdminActions!({
      from: '2026-03-02T00:00:00.000Z',
      to: '2026-03-06T00:00:00.000Z',
    });
    expect(rangeActions).toHaveLength(1);
    expect(rangeActions[0].id).toBe('act-2');

    await store.close();
  });

  it('refuses duplicate admin record IDs to preserve provenance integrity', async () => {
    const store = await create();

    const record: AdminAuditRecord = {
      id: 'unique-id-123',
      action: 'manual_purge',
      actor: 'admin',
      details: 'emergency purge',
      timestamp: new Date().toISOString(),
    };

    await store.recordAdminAction!(record);
    await expect(store.recordAdminAction!(record)).rejects.toThrow();

    await store.close();
  });
});

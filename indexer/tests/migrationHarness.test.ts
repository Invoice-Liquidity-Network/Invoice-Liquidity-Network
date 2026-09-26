/**
 * Integration tests for the zero-downtime migration safety harness (#1041):
 * budget pass/fail, the online-strategy override, lock measurement sanity,
 * and rollback schema-equality. Row counts are kept tiny so the suite stays
 * fast; production-scale dry-runs run in CI via scripts/migration-harness.ts.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from '../src/db';
import {
  budgetFor,
  checkBudget,
  loadBudgetFile,
  type MigrationBudgetFile,
} from '../src/migrationHarness/budgets';
import { dryRunMigration } from '../src/migrationHarness/dryRun';
import { MIGRATIONS, TEST_FIXTURE_MIGRATIONS, registryMigrations } from '../src/migrationHarness/migrations';
import { createSnapshotDb } from '../src/migrationHarness/snapshot';
import { schemaFingerprint, verifyRollback } from '../src/migrationHarness/rollback';
import type { HarnessMigration } from '../src/migrationHarness/types';

const BUDGET_FILE: MigrationBudgetFile = {
  maxLockMs: 5000,
  maxRunMs: 60_000,
  defaultPerMigration: { maxLockMs: 5000, maxRunMs: 60_000 },
  overrides: {
    '002_add_events_ledger_covering_index': { maxRunMs: 90_000 },
  },
};

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iln-harness-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

// ─── Budgets ──────────────────────────────────────────────────────────────────

describe('migration budgets', () => {
  const budget = { maxLockMs: 100, maxRunMs: 1000 };

  it('passes when measurements are within budget', () => {
    const check = checkBudget({ runMs: 500, lockMs: 10 }, budget, {});
    expect(check.ok).toBe(true);
    expect(check.overBudget).toBe(false);
  });

  it('fails when the lock budget is exceeded without an online strategy', () => {
    const check = checkBudget({ runMs: 500, lockMs: 101 }, budget, {});
    expect(check.ok).toBe(false);
    expect(check.overBudget).toBe(true);
    expect(check.reasons.join(' ')).toContain('lock duration');
  });

  it('fails when the runtime budget is exceeded without an online strategy', () => {
    const check = checkBudget({ runMs: 1001, lockMs: 1 }, budget, {});
    expect(check.ok).toBe(false);
    expect(check.reasons.join(' ')).toContain('total runtime');
  });

  it('passes an over-budget migration that declares an online strategy', () => {
    const check = checkBudget({ runMs: 10_000, lockMs: 10_000 }, budget, {
      onlineStrategy: 'expand-contract',
    });
    expect(check.ok).toBe(true);
    expect(check.overBudget).toBe(true);
  });

  it('treats a blank online strategy as no strategy at all', () => {
    const check = checkBudget({ runMs: 2000, lockMs: 1 }, budget, { onlineStrategy: '   ' });
    expect(check.ok).toBe(false);
  });

  it('resolves per-id overrides on top of defaults', () => {
    expect(budgetFor(BUDGET_FILE, 'some_other_migration')).toEqual({
      maxLockMs: 5000,
      maxRunMs: 60_000,
    });
    expect(budgetFor(BUDGET_FILE, '002_add_events_ledger_covering_index').maxRunMs).toBe(90_000);
    // maxLockMs falls back to the default while maxRunMs is overridden.
    expect(budgetFor(BUDGET_FILE, '002_add_events_ledger_covering_index').maxLockMs).toBe(5000);
  });

  it('loads the repo-root budget file shape', () => {
    const path = join(makeTmpDir(), 'migration-budget.json');
    writeFileSync(path, JSON.stringify(BUDGET_FILE));
    expect(loadBudgetFile(path).maxLockMs).toBe(5000);
    expect(() => loadBudgetFile(path + '.missing')).toThrow();
  });

  it('rejects a malformed budget file', () => {
    const path = join(makeTmpDir(), 'bad.json');
    writeFileSync(path, JSON.stringify({ maxLockMs: 'x' }));
    expect(() => loadBudgetFile(path)).toThrow(/required numbers/);
  });
});

// ─── Snapshot ─────────────────────────────────────────────────────────────────

describe('production-shaped snapshot', () => {
  it('seeds a real createDb schema with the requested row counts', () => {
    const db = createSnapshotDb(':memory:', { invoices: 500, events: 1200 });
    try {
      const invoices = db.prepare('SELECT COUNT(*) c FROM invoices').get() as { c: number };
      const events = db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number };
      expect(invoices.c).toBe(500);
      expect(events.c).toBe(1200);
      const columns = db.prepare('PRAGMA table_info(invoices)').all() as { name: string }[];
      expect(columns.map((c) => c.name)).toContain('freelancer');
    } finally {
      db.close();
    }
  });
});

// ─── Rollback verification ────────────────────────────────────────────────────

describe('rollback verification (down path exercised)', () => {
  it.each(MIGRATIONS.map((m) => [m.id, m] as const))(
    'up -> down -> up restores the exact schema for %s',
    (_id, migration) => {
      const result = verifyRollback(migration, { scale: { invoices: 100, events: 200 } });
      expect(result.failure).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.afterDown).toBe(result.before);
      expect(result.afterSecondUp).toBe(result.afterUp);
      expect(result.afterUp).not.toBe(result.before);
    }
  );

  it('detects a migration whose down path does not restore the schema', () => {
    const lying: HarnessMigration = {
      id: 'lying_migration',
      description: 'down() drops a different column than up() added',
      up: (db: Database.Database) => {
        db.exec(`ALTER TABLE invoices ADD COLUMN expiry_a INTEGER DEFAULT 0`);
      },
      down: (db: Database.Database) => {
        db.exec(`ALTER TABLE invoices DROP COLUMN expiry_a`);
        db.exec(`ALTER TABLE invoices ADD COLUMN expiry_b INTEGER DEFAULT 0`);
      },
    };
    const result = verifyRollback(lying, { scale: { invoices: 50, events: 50 } });
    expect(result.ok).toBe(false);
    expect(result.failure).toContain('down() did not restore');
  });

  it('flags an index mismatch via PRAGMA index_list fingerprints', () => {
    const db = createDb(':memory:') as Database.Database;
    const before = schemaFingerprint(db);
    db.exec(`CREATE INDEX tmp_probe_idx ON events(ledger, created_at)`);
    expect(schemaFingerprint(db)).not.toBe(before);
    db.exec(`DROP INDEX tmp_probe_idx`);
    expect(schemaFingerprint(db)).toBe(before);
    db.close();
  });
});

// ─── Dry-run measurement ──────────────────────────────────────────────────────

describe('dry-run measurement on a snapshot', () => {
  it('measures runtime and concurrent-reader lock latency', async () => {
    const dir = makeTmpDir();
    const migration = MIGRATIONS[0];
    const measurement = await dryRunMigration(migration, join(dir, 'snap.db'), {
      invoices: 1_000,
      events: 2_000,
    });
    expect(measurement.id).toBe(migration.id);
    expect(measurement.runMs).toBeGreaterThanOrEqual(0);
    expect(measurement.lockMs).toBeGreaterThanOrEqual(0);
    // The reader must actually have run concurrently.
    expect(measurement.reads).toBeGreaterThan(0);
  });

  it('fails a budget-exceeding migration without an online strategy and passes it with one', async () => {
    const dir = makeTmpDir();
    const fixture = TEST_FIXTURE_MIGRATIONS[0];
    const measurement = await dryRunMigration(fixture, join(dir, 'fixture.db'), {
      invoices: 500,
      events: 500,
    });
    const tightBudget = { maxLockMs: 1, maxRunMs: 0 };
    const withoutStrategy = checkBudget(measurement, tightBudget, fixture);
    expect(withoutStrategy.overBudget).toBe(true);
    expect(withoutStrategy.ok).toBe(false);

    const withStrategy: HarnessMigration = { ...fixture, onlineStrategy: 'expand-contract' };
    const overridden = checkBudget(measurement, tightBudget, withStrategy);
    expect(overridden.ok).toBe(true);
  });

  it('registry does not include test fixtures unless explicitly enabled', () => {
    expect(registryMigrations().some((m) => m.id.startsWith('fixture_'))).toBe(false);
    expect(
      registryMigrations({ includeFixtures: true }).some((m) => m.id.startsWith('fixture_'))
    ).toBe(true);
  });
});

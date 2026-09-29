# Database Migration Workflow

## Overview

This document explains how database migrations work in the Invoice Liquidity
Network project: when to add one, the naming convention, how the migration
runner works, and how migrations are applied in each deployment environment.

Migrations are managed by `scripts/migrate.ts` which discovers and runs
migration files from `scripts/migrations/`.

---

## Migration File Convention

Each migration is a single file in `scripts/migrations/` following this naming
pattern:

```
<NUMBER>_<description>.ts
```

- **`<NUMBER>`** — A zero-padded, three-digit sequence number (e.g. `001`, `002`).
  Higher numbers are applied later.
- **`<description>`** — A short, kebab-case description of what the migration
  does (e.g. `add_invoice_expiry_column`, `create_reputation_index`).

Example filenames:

```
001_add_invoice_expiry_column.ts
002_create_reputation_index.ts
003_add_notification_preferences.ts
```

### Migration File Structure

Each file must export three things:

| Export | Type | Required | Description |
|---|---|---|---|
| `description` | `string` | Yes | A human-readable summary of the migration |
| `up` | `(ctx: MigrationContext) => void \| Promise<void>` | Yes | Apply the migration |
| `down` | `(ctx: MigrationContext) => void \| Promise<void>` | Yes | Roll back the migration |

The `MigrationContext` provides:

- `network: "testnet" | "mainnet"` — the target network
- `dryRun: boolean` — whether this is a dry run (log only, no changes)
- `log(msg: string): void` — a logger that adds timestamps

### Example Migration

```typescript
// scripts/migrations/001_add_invoice_expiry_column.ts
// Run: npx ts-node scripts/migrate.ts up

import { MigrationContext } from "../migrate";

export const description = "Add invoice_expiry column to invoices table";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log(`Adding "invoice_expiry" column...`);
  if (!ctx.dryRun) {
    // Execute ALTER TABLE or equivalent
    // e.g. await db.run(`ALTER TABLE invoices ADD COLUMN invoice_expiry INTEGER`);
  }
  ctx.log("Done.");
}

export async function down(ctx: MigrationContext): Promise<void> {
  ctx.log(`Removing "invoice_expiry" column...`);
  if (!ctx.dryRun) {
    // Roll back: e.g. ALTER TABLE invoices DROP COLUMN invoice_expiry
  }
  ctx.log("Done.");
}
```

---

## How the Migration Runner Works

The runner (`scripts/migrate.ts`) supports three commands:

```bash
# Show applied/pending status of all migrations
npx ts-node scripts/migrate.ts status

# Apply all pending migrations
npx ts-node scripts/migrate.ts up

# Roll back the most recently applied migration
npx ts-node scripts/migrate.ts down

# Safety flags
npx ts-node scripts/migrate.ts up --network=mainnet  # target mainnet
npx ts-node scripts/migrate.ts up --dry-run           # log only, no changes
```

### Status Tracking

Applied migrations are recorded in `migration-status.json` at the repo root.
This file maps migration names to their applied timestamp.

### ⚠️ Important notes

- The status file is **local to each checkout**. It is not automatically synced
  across environments. On CI/deployed environments, ensure the status file is
  either committed or bootstrapped before running migrations.
- Migrations run **in sequence** based on the numeric prefix. Two team members
  adding migrations in parallel should use different sequence numbers and merge
  carefully.
- A migration's `down()` must undo exactly what `up()` did, so rollbacks are
  reliable.

---

## Worked Example: Adding a Column

Let's walk through adding a new `invoice_expiry` column to the indexer's
SQLite database end-to-end.

### 1. Create the migration file

```bash
echo "Generating migration file..."
cat > scripts/migrations/001_add_invoice_expiry_column.ts << 'EOF'
import { MigrationContext } from "../migrate";

export const description = "Add invoice_expiry column to invoices table";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("Adding invoice_expiry column...");
  if (!ctx.dryRun) {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database("indexer.db");
    db.exec(`ALTER TABLE invoices ADD COLUMN invoice_expiry INTEGER DEFAULT 0`);
    db.close();
  }
  ctx.log("Column added.");
}

export async function down(ctx: MigrationContext): Promise<void> {
  ctx.log("Removing invoice_expiry column...");
  if (!ctx.dryRun) {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database("indexer.db");
    db.exec(`ALTER TABLE invoices DROP COLUMN invoice_expiry`);
    db.close();
  }
  ctx.log("Column removed.");
}
EOF
```

### 2. Run the migration locally

```bash
npx ts-node scripts/migrate.ts up
```

Expected output:
```
[2026-07-27T12:00:00.000Z] Applying: 001_add_invoice_expiry_column — Add invoice_expiry column to invoices table
[2026-07-27T12:00:00.500Z] Adding invoice_expiry column...
[2026-07-27T12:00:01.000Z] Column added.
[2026-07-27T12:00:01.000Z] Done: 001_add_invoice_expiry_column
```

### 3. Verify the status

```bash
npx ts-node scripts/migrate.ts status
```

Expected output:
```
Migration                    Status
────────────────────────────────────────────────
001_add_invoice_expiry_column  applied 2026-07-27T12:00:01.000Z
```

### 4. Roll back if needed

```bash
npx ts-node scripts/migrate.ts down
```

---

## CI / Deployment Environment

### Testnet

Migrations run automatically as part of the deployment workflow. The CI runner
maintains a fresh SQLite database per run, so migrations are typically applied
from scratch each time.

### Mainnet / Production

Migrations for production databases should be:

1. **Tested locally** with `--dry-run` first.
2. **Applied manually** by a maintainer using the `scripts/migrate.ts up` command
   from a secure environment with access to the production database.
3. **Logged** with the exact output for the deployment record.

> **Never run `--dry-run` as a substitute for testing against a staging copy
> of the production database.** A dry run skips the actual DDL/DML, so it
> cannot catch schema conflicts or data migration errors.

---

## Relationship to `db.ts` (Indexer)

The indexer's `indexer/src/db.ts` defines the initial database schema. If you
add a migration that changes the schema, you should also update `db.ts` so that
new deployments start with the correct schema without needing to run the full
migration chain.

---

## Zero-Downtime Migration Safety Harness (issue #1041)

Schema changes on a live SQLite database take **exclusive write locks**; a migration
that holds that lock longer than the acceptable downtime window degrades the API even
though WAL mode keeps readers running. The migration harness makes that cost visible
*before* a migration ships.

### What it does

| Check | Mechanism |
|---|---|
| Production-scale dry-run | Seeds a throwaway DB shaped like production (default 500k invoices / 1.5M events; CI scale 100k/300k), applies the migration, and measures total runtime plus a **lock-duration proxy**: the worst read latency observed by a concurrent reader on a second connection while the migration transaction runs. |
| Budget gate | Compares measurements against `migration-budget.json` at the repo root (global defaults, per-migration `defaultPerMigration`, and `overrides[id]`). Over budget ⇒ **FAIL**, unless the migration declares a non-empty `onlineStrategy` (expand-contract, create-index-concurrently, …) acknowledging the downtime. |
| Rollback verification | Exercises `up → down → up` and compares `PRAGMA table_info` / `index_list` fingerprints — a `down()` that "succeeds" but leaves a different schema is caught. |

### Commands

```bash
# measure + budget-gate every registered migration (projected mainnet scale)
pnpm migration-harness dry-run

# CI-friendly snapshot (100k invoices / 300k events)
pnpm migration-harness dry-run --ci-scale

# custom seed sizes
pnpm migration-harness dry-run --invoices 250000 --events 750000

# prove every down() actually restores the schema
pnpm migration-harness rollback-verify

# full gate + rollback for one migration
pnpm migration-harness check 001_add_invoice_expiry_column
```

Exit code is non-zero on any budget violation without an online strategy, or any
rollback mismatch. `CI=true` workflows run the harness automatically via
`.github/workflows/indexer-migration-harness.yml`.

Migrations under test live in the registry at
`indexer/src/migrationHarness/migrations.ts` — mirror new schema changes there
(plus a budget-exceeding fixture is kept behind `--fixtures` for harness self-tests).

### Budget file

`migration-budget.json` (repo root):

```json
{
  "maxLockMs": 5000,
  "maxRunMs": 120000,
  "defaultPerMigration": { "maxLockMs": 5000, "maxRunMs": 120000 },
  "overrides": {
    "002_add_events_ledger_covering_index": { "maxRunMs": 180000 }
  }
}
```

---

## Migration Review Checklist

A reviewer should be able to say "yes" to every line before a schema migration merges:

- [ ] **Lock budget** — `pnpm migration-harness dry-run --ci-scale` passes: measured
      run time and lock-duration proxy are inside `migration-budget.json`, or the
      overage is explicitly accepted via a declared `onlineStrategy`.
- [ ] **Production-scale dry-run** — run against the projected mainnet shape
      (default scale of the harness) for migrations touching large tables
      (`invoices`, `events`), not just the CI scale.
- [ ] **Online strategy** — if the migration can exceed the lock budget on production
      data, the harness entry declares *how* it is applied with zero downtime
      (expand-contract, dual-write, `CREATE INDEX` on a separate connection, etc.)
      and the deploy runbook references it.
- [ ] **Rollback verified** — `pnpm migration-harness rollback-verify` passes: the
      `down()` restores the exact prior schema (column sets and indexes are
      fingerprint-compared) and re-applying `up()` afterwards still works.
- [ ] **`db.ts` mirror updated** — new deployments from `indexer/src/db.ts` produce
      the post-migration schema without replaying the chain.
- [ ] **Registered in the harness** — the migration exists in
      `indexer/src/migrationHarness/migrations.ts` so CI keeps measuring it.

---

## References

- `scripts/migrate.ts` — the migration runner
- `scripts/migration-harness.ts` — zero-downtime safety harness CLI
- `indexer/src/migrationHarness/` — harness modules (snapshot, dry-run, budgets, rollback)
- `migration-budget.json` — runtime/lock budgets
- `scripts/migrations/` — migration files directory
- `migration-status.json` — local tracking of applied migrations
- `indexer/src/db.ts` — initial database schema definition
- [Indexer Data Model](./indexer-data-model.md) — schema reference
- [Local Development](./local-development.md) — how to set up the indexer locally
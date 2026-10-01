#!/usr/bin/env node
/**
 * Migration framework for ILN contract upgrades.
 *
 * Migration files live in scripts/migrations/ and export:
 *   - description: string
 *   - up(ctx):   void | Promise<void>   — apply the migration
 *   - down(ctx): void | Promise<void>   — roll it back
 *
 * Usage:
 *   npx ts-node scripts/migrate.ts status
 *   npx ts-node scripts/migrate.ts up [--dry-run] [--network=mainnet]
 *   npx ts-node scripts/migrate.ts down [--dry-run] [--network=mainnet]
 */

import fs from 'fs';
import path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface MigrationContext {
  network: 'testnet' | 'mainnet';
  dryRun: boolean;
  log(msg: string): void;
}

export interface Migration {
  name: string;
  description: string;
  up(ctx: MigrationContext): void | Promise<void>;
  down(ctx: MigrationContext): void | Promise<void>;
}

export interface MigrationRecord {
  name: string;
  appliedAt: string;
}

export interface MigrationStatus {
  name: string;
  description: string;
  appliedAt: string | null;
}

// ── Status persistence ─────────────────────────────────────────────────────

const STATUS_FILE = path.resolve('migration-status.json');
const MIGRATIONS_DIR = path.resolve('scripts/migrations');

function readApplied(): MigrationRecord[] {
  if (!fs.existsSync(STATUS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')) as MigrationRecord[];
  } catch {
    return [];
  }
}

function writeApplied(records: MigrationRecord[]): void {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(records, null, 2) + '\n');
}

function markApplied(name: string, records: MigrationRecord[]): MigrationRecord[] {
  return [...records.filter((r) => r.name !== name), { name, appliedAt: new Date().toISOString() }];
}

function markUnapplied(name: string, records: MigrationRecord[]): MigrationRecord[] {
  return records.filter((r) => r.name !== name);
}

// ── Loading ────────────────────────────────────────────────────────────────

async function loadMigrations(): Promise<Migration[]> {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.*\.(ts|js)$/.test(f))
    .sort();

  const migrations: Migration[] = [];
  for (const file of files) {
    const mod = (await import(path.join(MIGRATIONS_DIR, file))) as Partial<Migration>;
    migrations.push({
      name: file.replace(/\.(ts|js)$/, ''),
      description: mod.description ?? file,
      up: mod.up ?? (() => {}),
      down: mod.down ?? (() => {}),
    });
  }
  return migrations;
}

// ── Commands ───────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString();
}

function logLine(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

/** Apply all pending migrations in order. */
export async function runUp(options: {
  network: 'testnet' | 'mainnet';
  dryRun: boolean;
}): Promise<void> {
  const ctx: MigrationContext = { ...options, log: logLine };
  const migrations = await loadMigrations();
  let applied = readApplied();
  const appliedNames = new Set(applied.map((r) => r.name));

  const pending = migrations.filter((m) => !appliedNames.has(m.name));
  if (pending.length === 0) {
    logLine('No pending migrations.');
    return;
  }

  for (const m of pending) {
    logLine(`${options.dryRun ? '[DRY RUN] ' : ''}Applying: ${m.name} — ${m.description}`);
    if (!options.dryRun) {
      await m.up(ctx);
      applied = markApplied(m.name, applied);
      writeApplied(applied);
    }
    logLine(`${options.dryRun ? '[DRY RUN] ' : ''}Done: ${m.name}`);
  }
}

/** Roll back the most recently applied migration. */
export async function runDown(options: {
  network: 'testnet' | 'mainnet';
  dryRun: boolean;
}): Promise<void> {
  const ctx: MigrationContext = { ...options, log: logLine };
  const migrations = await loadMigrations();
  let applied = readApplied();

  if (applied.length === 0) {
    logLine('No migrations to roll back.');
    return;
  }

  const last = applied[applied.length - 1];
  const migration = migrations.find((m) => m.name === last.name);
  if (!migration) {
    throw new Error(`Migration file not found for recorded entry: ${last.name}`);
  }

  logLine(
    `${options.dryRun ? '[DRY RUN] ' : ''}Rolling back: ${migration.name} — ${
      migration.description
    }`
  );
  if (!options.dryRun) {
    await migration.down(ctx);
    applied = markUnapplied(migration.name, applied);
    writeApplied(applied);
  }
  logLine(`${options.dryRun ? '[DRY RUN] ' : ''}Rolled back: ${migration.name}`);
}

/** Print the applied/pending status of every migration. */
export async function runStatus(): Promise<void> {
  const migrations = await loadMigrations();
  if (migrations.length === 0) {
    logLine('No migration files found in scripts/migrations/');
    return;
  }

  const applied = readApplied();
  const appliedMap = new Map(applied.map((r) => [r.name, r.appliedAt]));

  const rows: MigrationStatus[] = migrations.map((m) => ({
    name: m.name,
    description: m.description,
    appliedAt: appliedMap.get(m.name) ?? null,
  }));

  const colW = Math.max(...rows.map((r) => r.name.length), 12);
  console.log(`\n${'Migration'.padEnd(colW + 2)}Status`);
  console.log('─'.repeat(colW + 32));
  for (const row of rows) {
    const status = row.appliedAt ? `applied  ${row.appliedAt}` : 'pending';
    console.log(`${row.name.padEnd(colW + 2)}${status}`);
  }
  console.log('');
}

// ── CLI entrypoint ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  command: string;
  network: 'testnet' | 'mainnet';
  dryRun: boolean;
} {
  return {
    command: argv[0] ?? 'status',
    network: argv.includes('--network=mainnet') ? 'mainnet' : 'testnet',
    dryRun: argv.includes('--dry-run'),
  };
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const { command, network, dryRun } = parseArgs(process.argv.slice(2));
  const run = async () => {
    switch (command) {
      case 'up':
        await runUp({ network, dryRun });
        break;
      case 'down':
        await runDown({ network, dryRun });
        break;
      case 'status':
        await runStatus();
        break;
      default:
        console.error(`Unknown command: ${command}. Use: up | down | status`);
        process.exitCode = 1;
    }
  };
  run().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

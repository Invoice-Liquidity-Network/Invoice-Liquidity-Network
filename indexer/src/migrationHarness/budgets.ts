import { readFileSync } from 'fs';
import type { HarnessMigration, MigrationMeasurement } from './types';

export interface MigrationBudget {
  /** Maximum tolerated exclusive-lock hold, in ms. */
  maxLockMs: number;
  /** Maximum tolerated total migration runtime, in ms. */
  maxRunMs: number;
}

export interface MigrationBudgetFile {
  maxLockMs: number;
  maxRunMs: number;
  defaultPerMigration?: Partial<MigrationBudget>;
  /** Per-migration budget overrides keyed by migration id. */
  overrides?: Record<string, Partial<MigrationBudget>>;
}

export function loadBudgetFile(path: string): MigrationBudgetFile {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as MigrationBudgetFile;
  if (typeof parsed.maxLockMs !== 'number' || typeof parsed.maxRunMs !== 'number') {
    throw new Error(`Invalid budget file ${path}: maxLockMs and maxRunMs are required numbers`);
  }
  return parsed;
}

/** Resolve the effective budget for a migration id (defaults + per-id overrides). */
export function budgetFor(file: MigrationBudgetFile, id: string): MigrationBudget {
  const defaults: MigrationBudget = {
    maxLockMs: file.defaultPerMigration?.maxLockMs ?? file.maxLockMs,
    maxRunMs: file.defaultPerMigration?.maxRunMs ?? file.maxRunMs,
  };
  const override = file.overrides?.[id] ?? {};
  return {
    maxLockMs: override.maxLockMs ?? defaults.maxLockMs,
    maxRunMs: override.maxRunMs ?? defaults.maxRunMs,
  };
}

export interface BudgetCheck {
  /** True when the migration may proceed: within budget, or over budget with an online strategy. */
  ok: boolean;
  /** True when either measurement exceeded its budget. */
  overBudget: boolean;
  /** Human-readable budget violations (present when `overBudget`). */
  reasons: string[];
}

/**
 * Enforce the harness rule: a migration exceeding its lock/runtime budget
 * FAILS the check unless it declares a non-empty `onlineStrategy` naming the
 * approach that keeps it safe under load.
 */
export function checkBudget(
  measurement: Pick<MigrationMeasurement, 'runMs' | 'lockMs'>,
  budget: MigrationBudget,
  migration: Pick<HarnessMigration, 'onlineStrategy'>
): BudgetCheck {
  const reasons: string[] = [];
  if (measurement.lockMs > budget.maxLockMs) {
    reasons.push(
      `lock duration ${measurement.lockMs.toFixed(1)}ms exceeds budget ${budget.maxLockMs}ms`
    );
  }
  if (measurement.runMs > budget.maxRunMs) {
    reasons.push(
      `total runtime ${measurement.runMs.toFixed(1)}ms exceeds budget ${budget.maxRunMs}ms`
    );
  }
  const overBudget = reasons.length > 0;
  const hasOnlineStrategy =
    typeof migration.onlineStrategy === 'string' && migration.onlineStrategy.trim().length > 0;
  return {
    ok: !overBudget || hasOnlineStrategy,
    overBudget,
    reasons,
  };
}

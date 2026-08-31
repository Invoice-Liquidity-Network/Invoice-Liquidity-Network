import type { MigrationContext } from '../migrate';

export const description = 'Record initial contract deployment in migration history';

/** Apply: verify the contract is reachable and log the deployment baseline. */
export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log(`[001] Confirming initial contract baseline on ${ctx.network}`);
  // In a real migration this would invoke stellar contract commands to verify
  // or update on-chain storage, seed initial data, or set config keys.
  ctx.log('[001] Baseline confirmed.');
}

/** Rollback: undo the baseline record (no-op for initial setup). */
export async function down(ctx: MigrationContext): Promise<void> {
  ctx.log(`[001] Reversing initial contract baseline on ${ctx.network}`);
  // Nothing destructive to undo for the initial marker migration.
  ctx.log('[001] Rollback complete.');
}

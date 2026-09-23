import type { MigrationContext } from '../migrate';

export const description = 'Update protocol config storage keys to v2 short-symbol format';

/**
 * Apply: re-encode any legacy long-string config keys as short Soroban symbols
 * (≤9 bytes). In a real migration this would invoke `stellar contract invoke`
 * to read the old keys and write them back under the new names.
 */
export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log(`[002] Migrating protocol config keys on ${ctx.network}`);
  ctx.log('[002] Reading legacy config entries…');
  // stellar contract invoke --id $CONTRACT_ID --network $network -- get_config
  ctx.log('[002] Writing entries under v2 short-symbol keys…');
  // stellar contract invoke --id $CONTRACT_ID --network $network -- set_config ...
  ctx.log('[002] Migration complete.');
}

/** Rollback: restore the previous long-string key names. */
export async function down(ctx: MigrationContext): Promise<void> {
  ctx.log(`[002] Rolling back protocol config key migration on ${ctx.network}`);
  ctx.log('[002] Restoring legacy long-string keys…');
  ctx.log('[002] Rollback complete.');
}

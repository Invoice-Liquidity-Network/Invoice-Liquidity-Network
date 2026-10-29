import { config as loadEnv } from 'dotenv';
import { CONFIG_EXIT_CODE, reportConfigValidation, validateIndexerEnv } from './configValidation';

/**
 * Indexer entry point.
 *
 * Startup is fail-closed: the environment is validated *before* any other
 * module is loaded, because several modules read CONFIG (and the confirmation
 * policy validates its depth) at import time. On any configuration error the
 * process logs every problem and exits with code 78 (EX_CONFIG) without
 * opening the port, polling the RPC node or touching the database.
 * See docs/indexer/operations-checks.md.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number | null> {
  loadEnv();
  const result = validateIndexerEnv(env);
  if (!reportConfigValidation(env, result)) {
    return CONFIG_EXIT_CODE;
  }

  // Deferred so nothing reads CONFIG until it has been validated.
  const { startServices } = await import('./server');
  await startServices(result.warnings.length);
  return null;
}

if (require.main === module) {
  main().then(
    (exitCode) => {
      // Nothing was started, so the process ends on its own with this code.
      if (exitCode !== null) process.exitCode = exitCode;
    },
    (err: unknown) => {
      console.error('[startup] Fatal error while starting the indexer:', err);
      // Services may already hold the event loop open (HTTP server, timers).
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }
  );
}

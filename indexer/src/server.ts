import http from 'http';
import { createApp } from './api';
import { CONFIG } from './config';
import { startPolling } from './poller';
import { createGraphQLServer } from './graphql/server';
import { startArchivalScheduler } from './archive';
import { startReconciliationScheduler } from './reconciliation';
import { BackupManager } from './backup';
import { configInfo, configWarnings } from './metrics';
import { networkForPassphrase } from './configValidation';

/**
 * Start every indexer service. Only called by `index.ts` after startup
 * configuration validation has passed, so the values in CONFIG are known good.
 */
export async function startServices(warningCount: number): Promise<void> {
  // Operator-visible proof that the startup control ran and passed for this
  // process (docs/indexer/operations-checks.md).
  configInfo.set(
    { network: networkForPassphrase(CONFIG.networkPassphrase), contract_id: CONFIG.contractId },
    1
  );
  configWarnings.set(warningCount);

  const app = createApp();
  const httpServer = http.createServer(app);

  const graphqlMiddleware = await createGraphQLServer(httpServer);
  app.use('/graphql', graphqlMiddleware);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(CONFIG.apiPort, () => {
      httpServer.off('error', reject);
      console.log(`[api] Listening on http://0.0.0.0:${CONFIG.apiPort}`);
      console.log(`[graphql] http://0.0.0.0:${CONFIG.apiPort}/graphql`);
      console.log(`[graphql] ws://0.0.0.0:${CONFIG.apiPort}/graphql`);
      resolve();
    });
  });

  startPolling();
  startReconciliationScheduler(3600000); // 1 hour interval

  if (CONFIG.archiveEnabled) {
    startArchivalScheduler(
      CONFIG.archiveIntervalMs,
      CONFIG.archiveOlderThanDays,
      CONFIG.archivePurgeOlderThanDays
    );
  }

  // Start automated backups if enabled
  if (CONFIG.backupEnabled) {
    const backupManager = new BackupManager({
      backupDir: CONFIG.backupDir,
      intervalMs: CONFIG.backupIntervalMs,
      maxLocalBackups: CONFIG.backupMaxLocal,
      cloud: CONFIG.backupCloudProvider
        ? {
            provider: CONFIG.backupCloudProvider,
            bucket: CONFIG.backupCloudBucket ?? '',
            prefix: CONFIG.backupCloudPrefix,
            region: CONFIG.backupCloudRegion,
          }
        : undefined,
    });
    backupManager.start();
    console.log('[backup] Automated backups enabled');
  }
}

import http from 'http';
import { createApp } from './api';
import { CONFIG } from './config';
import { startPolling } from './poller';
import { createGraphQLServer } from './graphql/server';
import { startArchivalScheduler } from './archive';
import { BackupManager } from './backup';

async function main() {
  const app = createApp();
  const httpServer = http.createServer(app);

  const graphqlMiddleware = await createGraphQLServer(httpServer);
  app.use('/graphql', graphqlMiddleware);

  httpServer.listen(CONFIG.apiPort, () => {
    console.log(`[api] Listening on http://0.0.0.0:${CONFIG.apiPort}`);
    console.log(`[graphql] http://0.0.0.0:${CONFIG.apiPort}/graphql`);
    console.log(`[graphql] ws://0.0.0.0:${CONFIG.apiPort}/graphql`);
  });

  startPolling();

  if (CONFIG.archiveEnabled) {
    startArchivalScheduler(CONFIG.archiveIntervalMs, CONFIG.archiveOlderThanDays);
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

main();

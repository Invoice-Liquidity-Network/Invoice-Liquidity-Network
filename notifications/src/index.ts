import http from 'http';
import { createApp } from './api';
import { startPolling } from './poller';
import { NotificationWebSocketServer } from './websocket';
import { CONFIG } from './config';
import { TemplateEngine } from './template-engine';
import { digestScheduler } from './digest';
import { startHealthChecks } from './provider-health';
import { startRetentionScheduler } from './retention';
import { assertRecipientKeyConfigured } from './recipient-crypto';

// Issue #1280: refuse to boot without a usable recipient key in production,
// rather than failing on the first notification.
assertRecipientKeyConfigured();

const app = createApp();
const server = http.createServer(app);
const wsServer = new NotificationWebSocketServer(CONFIG.port + 1);

wsServer.start(server);

server.listen(CONFIG.port, () => {
  console.log(`[notifications] HTTP server listening on http://localhost:${CONFIG.port}`);
  console.log(`[notifications] WebSocket server listening on ws://localhost:${CONFIG.port + 1}/ws`);
});

// #1282: restore persisted digest registrations and pending items, then start
// the tick so buffered digests are actually flushed (and reconciled).
const restoredDigests = digestScheduler.restore();
console.log(`[notifications] Restored ${restoredDigests} digest registration(s)`);
digestScheduler.start();

startPolling().catch((err) => {
  console.error('[notifications] Failed to start poller:', err);
  process.exit(1);
});

// Automatic provider health checking with fallback routing — probes every 30s
startHealthChecks();
startRetentionScheduler();

export { app, server, wsServer, TemplateEngine };
export type {
  Template,
  TemplateContext,
  RenderResult,
  TemplateTestResult,
} from './template-engine';
export {
  DLQ_ALERT_THRESHOLD,
  MAX_RETRIES,
  MAX_RETRY_DELAY_MS,
  getDeadLetterEntries,
  getDeadLetterCount,
  replayDeadLetter,
  clearDeadLetterQueue,
  getRetryMetrics,
} from './delivery';

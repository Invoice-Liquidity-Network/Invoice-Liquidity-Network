import http from 'http';
import { createApp } from './api';
import { startPolling } from './poller';
import { NotificationWebSocketServer } from './websocket';
import { CONFIG } from './config';
import { TemplateEngine } from './template-engine';

const app = createApp();
const server = http.createServer(app);
const wsServer = new NotificationWebSocketServer(CONFIG.port + 1);

wsServer.start(server);

server.listen(CONFIG.port, () => {
  console.log(`[notifications] HTTP server listening on http://localhost:${CONFIG.port}`);
  console.log(`[notifications] WebSocket server listening on ws://localhost:${CONFIG.port + 1}/ws`);
});

startPolling().catch((err) => {
  console.error('[notifications] Failed to start poller:', err);
  process.exit(1);
});

export { app, server, wsServer, TemplateEngine };
export type {
  Template,
  TemplateContext,
  RenderResult,
  TemplateTestResult,
} from './template-engine';

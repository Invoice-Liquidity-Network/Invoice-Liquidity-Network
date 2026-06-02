import { createApp } from './api';
import { startPolling } from './poller';
import { CONFIG } from './config';

const app = createApp();

app.listen(CONFIG.port, () => {
  console.log(`[notifications] HTTP server listening on http://localhost:${CONFIG.port}`);
});

startPolling().catch((err) => {
  console.error('[notifications] Failed to start poller:', err);
  process.exit(1);
});

export { app };

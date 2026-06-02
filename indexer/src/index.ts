import { createApp } from './api';
import { CONFIG } from './config';
import { startPolling } from './poller';

const app = createApp();

app.listen(CONFIG.apiPort, () => {
  console.log(`[api] Listening on http://0.0.0.0:${CONFIG.apiPort}`);
});

startPolling();

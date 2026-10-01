import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

// Whitelist the loopback address supertest's in-process requests originate
// from, with a very low threshold, so we can prove whitelisted IPs are never
// throttled even when they blow past the limit non-whitelisted IPs would hit.
process.env.RATE_LIMIT_MAX = '2';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_WHITELIST = '127.0.0.1';

let app: Express;

beforeEach(async () => {
  const { createApp } = await import('../src/api');
  const { createDb, setDb } = await import('../src/db');
  setDb(createDb(':memory:'));
  app = createApp();
});

describe('Rate limit whitelist', () => {
  it('does not throttle whitelisted IPs even past the threshold', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
  });

  it('does not treat a spoofed arbitrary identifier as a whitelisted IP', async () => {
    const spoofed = await request(app)
      .get('/health')
      .set('X-Forwarded-For', 'monitoring-service');
    expect(spoofed.status).toBe(200);
    const next = await request(app).get('/health').set('X-Forwarded-For', 'monitoring-service');
    expect(next.status).toBe(200);
    const blocked = await request(app).get('/health').set('X-Forwarded-For', 'monitoring-service');
    expect(blocked.status).toBe(429);
  });
});

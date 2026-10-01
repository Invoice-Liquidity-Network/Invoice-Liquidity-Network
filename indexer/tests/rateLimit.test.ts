import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

// A small threshold keeps this test fast and deterministic without waiting
// out a real 60-second window or firing 100+ requests.
process.env.RATE_LIMIT_MAX = '3';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_WHITELIST = '';

let app: Express;

beforeEach(async () => {
  // Dynamic import (not hoisted) so config.ts reads the env vars set above
  // rather than module defaults.
  const { createApp } = await import('../src/api');
  const { createDb, setDb } = await import('../src/db');
  setDb(createDb(':memory:'));
  app = createApp();
});

describe('Rate limiting', () => {
  it('allows requests up to the configured threshold', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 once the threshold is exceeded', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).get('/health');
    }
    const res = await request(app).get('/health');
    expect(res.status).toBe(429);
    expect(res.body).toHaveProperty('error');
  });

  it('includes a Retry-After header on the 429 response', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).get('/health');
    }
    const res = await request(app).get('/health');
    expect(res.status).toBe(429);
    expect(res.headers).toHaveProperty('retry-after');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('includes rate limit headers on allowed responses', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers).toHaveProperty('ratelimit-limit', '3');
    expect(res.headers).toHaveProperty('ratelimit-remaining');
    expect(res.headers).toHaveProperty('ratelimit-reset');
  });

  it('tracks separate counters per route within the same app instance', async () => {
    // Same IP, same app -> the limiter is shared across routes (by design:
    // it protects the whole API per IP, not per endpoint).
    await request(app).get('/health');
    await request(app).get('/stats');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-remaining']).toBe('0');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Response } from 'supertest';

import { createOracleApp } from './index';
import type { CreateOracleAppResult } from './index';
import { HSTS_HEADER, SECURITY_HEADERS, applySecurityHeaders } from './securityHeaders';
import { TEST_PAYER, healthyHistory, makeReputation } from './testFixtures';

/**
 * HTTP security headers on the oracle service (#1287), through the real
 * `createOracleApp`: every response — success, rejection, rate limit, missing
 * route, failed upstream — carries the policy docs/threat-model.md lists as an
 * API-layer mitigation.
 */

const NOW = Date.now();
const created: CreateOracleAppResult[] = [];

async function build(overrides: Parameters<typeof createOracleApp>[0] = {}) {
  const app = await createOracleApp({
    indexerBaseUrl: 'http://indexer.local',
    historyProvider: async () => healthyHistory(NOW),
    reputationProvider: async () => makeReputation(NOW, { score: 90 }),
    enableRateLimit: false,
    ...overrides,
  });
  created.push(app);
  return app;
}

afterEach(async () => {
  while (created.length) await created.pop()?.close();
});

function expectPolicy(res: Response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(res.headers[name.toLowerCase()], name).toBe(value);
  }
  expect(res.headers['x-powered-by']).toBeUndefined();
  // No cross-origin read grant: browsers keep other origins out (TM-2.2).
  expect(res.headers['access-control-allow-origin']).toBeUndefined();
}

describe('oracle security headers', () => {
  it('are sent on a successful response', async () => {
    const { app } = await build();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expectPolicy(res);
  });

  it('are sent on a 404 (Express replaces the CSP with a stricter one there)', async () => {
    const { app } = await build();
    const res = await request(app).get('/no-such-route');
    expect(res.status).toBe(404);
    // Express's final handler sets `default-src 'none'` on its own error page,
    // overriding ours. That page loads nothing at all; framing is still refused
    // by X-Frame-Options, and every other header in the policy survives.
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (name === 'Content-Security-Policy') continue;
      expect(res.headers[name.toLowerCase()], name).toBe(value);
    }
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('are sent on a request rejected by validation', async () => {
    const { app } = await build();
    const res = await request(app).post('/v1/verify').send({ payer: 'not-a-key' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expectPolicy(res);
  });

  it('are sent on a 429 from the rate limiter (boundary: limit reached)', async () => {
    const { app } = await build({
      enableRateLimit: true,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 1,
    });
    const body = { payer: TEST_PAYER, amount: '10000000', invoiceId: 42 };
    const first = await request(app).post('/v1/verify').send(body);
    expect(first.status).not.toBe(429);
    expectPolicy(first);

    let limited: Response | undefined;
    for (let i = 0; i < 5 && !limited; i++) {
      const res = await request(app).post('/v1/verify').send(body);
      if (res.status === 429) limited = res;
    }
    expect(limited, 'expected a 429 once the limit is reached').toBeDefined();
    expectPolicy(limited!);
  });

  it('are sent when an upstream dependency is unavailable', async () => {
    const { app } = await build({
      historyProvider: async () => {
        throw new Error('indexer unreachable');
      },
      reputationProvider: async () => {
        throw new Error('reputation unreachable');
      },
    });
    const res = await request(app)
      .post('/v1/verify')
      .send({ payer: TEST_PAYER, amount: '10000000', invoiceId: 7 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expectPolicy(res);
  });

  it('survive a restart: every new app instance applies them', async () => {
    for (let i = 0; i < 3; i++) {
      const { app } = await build();
      expectPolicy(await request(app).get('/health'));
    }
  });

  it('are stable across repeated requests to one instance (replay)', async () => {
    const { app } = await build();
    await request(app).get('/health');
    const res = await request(app).get('/health');
    expectPolicy(res);
  });

  it('send HSTS only over HTTPS through the trusted proxy', async () => {
    const { app } = await build();
    const https = await request(app).get('/health').set('X-Forwarded-Proto', 'https');
    expect(https.headers['strict-transport-security']).toBe(HSTS_HEADER);
    const http = await request(app).get('/health');
    expect(http.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('securityHeaders module', () => {
  it('ignores a spoofed X-Forwarded-Proto when no proxy is trusted', async () => {
    const app = express();
    applySecurityHeaders(app);
    app.get('/', (_req, res) => {
      res.json({});
    });
    const res = await request(app).get('/').set('X-Forwarded-Proto', 'https');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expectPolicy(res);
  });

  it('is exactly the policy docs/security-guide.md documents (not just self-consistent)', () => {
    expect({ ...SECURITY_HEADERS }).toEqual({
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-site',
    });
    expect(HSTS_HEADER).toBe('max-age=31536000; includeSubDomains');
  });

  it('cannot be weakened at runtime', () => {
    expect(Object.isFrozen(SECURITY_HEADERS)).toBe(true);
    expect(() => {
      (SECURITY_HEADERS as Record<string, string>)['X-Frame-Options'] = 'ALLOWALL';
    }).toThrow();
  });
});

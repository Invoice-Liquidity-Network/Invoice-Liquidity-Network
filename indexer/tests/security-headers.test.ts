import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Response } from 'supertest';
import { HSTS_HEADER, SECURITY_HEADERS, applySecurityHeaders } from '../src/securityHeaders';

/**
 * The indexer's HTTP security headers (#1287). `createApp()` calls
 * `applySecurityHeaders(app)` first (checked statically by
 * scripts/check-security-docs.mjs); these cases pin the behaviour of what it
 * registers, on an app shaped like the indexer's (trusted proxy, JSON body,
 * a rate-limited route, a failing route).
 */

function indexerLikeApp() {
  const app = express();
  app.set('trust proxy', 1);
  applySecurityHeaders(app);
  app.use(express.json());
  let hits = 0;
  app.get('/v1/invoices', (_req, res) => {
    hits += 1;
    if (hits > 1) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    res.json({ invoices: [] });
  });
  app.get('/v1/health', (_req, res) => {
    res.status(503).json({ status: 'error', db: 'error' });
  });
  app.get('/boom', () => {
    throw new Error('dependency failed');
  });
  return app;
}

function expectPolicy(res: Response, { expressErrorPage = false } = {}) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    // Express's own error pages replace the CSP with `default-src 'none'`.
    if (expressErrorPage && name === 'Content-Security-Policy') {
      expect(res.headers['content-security-policy']).toBe("default-src 'none'");
      continue;
    }
    expect(res.headers[name.toLowerCase()], name).toBe(value);
  }
  expect(res.headers['x-powered-by']).toBeUndefined();
  // No cross-origin read grant: browsers keep other origins out (TM-2.2).
  expect(res.headers['access-control-allow-origin']).toBeUndefined();
}

describe('indexer security headers', () => {
  it('are sent on success and on a 429 at the rate limit boundary', async () => {
    const app = indexerLikeApp();
    expectPolicy(await request(app).get('/v1/invoices'));
    const limited = await request(app).get('/v1/invoices');
    expect(limited.status).toBe(429);
    expectPolicy(limited);
  });

  it('are sent when the database is unavailable (503 health)', async () => {
    const res = await request(indexerLikeApp()).get('/v1/health');
    expect(res.status).toBe(503);
    expectPolicy(res);
  });

  it('are sent on 404 and on an unhandled error', async () => {
    const missing = await request(indexerLikeApp()).get('/nope');
    expect(missing.status).toBe(404);
    expectPolicy(missing, { expressErrorPage: true });
    const boom = await request(indexerLikeApp()).get('/boom');
    expect(boom.status).toBe(500);
    expectPolicy(boom, { expressErrorPage: true });
  });

  it('are applied by every new app instance (restart)', async () => {
    for (let i = 0; i < 3; i++) expectPolicy(await request(indexerLikeApp()).get('/v1/invoices'));
  });

  it('send HSTS only for HTTPS through the trusted proxy', async () => {
    const https = await request(indexerLikeApp())
      .get('/v1/invoices')
      .set('X-Forwarded-Proto', 'https');
    expect(https.headers['strict-transport-security']).toBe(HSTS_HEADER);
    const http = await request(indexerLikeApp()).get('/v1/invoices');
    expect(http.headers['strict-transport-security']).toBeUndefined();
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

  it('do not restrict scripts, so Swagger UI and GraphiQL keep working', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).not.toMatch(/script-src|default-src/);
  });
});

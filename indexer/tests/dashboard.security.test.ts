import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { createDb, setDb } from '../src/db';
import { recordError, resetMetrics, sanitizeOperationalError } from '../src/dashboard';

describe('dashboard credential-leak protection', () => {
  beforeEach(() => {
    resetMetrics();
    setDb(createDb(':memory:'));
  });

  it('redacts credentials, paths, and stack traces', async () => {
    recordError(
      'database',
      'postgres://admin:super-secret@db/prod failed at C:\\Users\\admin\\db.ts\n at /home/runner/indexer.ts'
    );
    const response = await request(createApp()).get('/v1/dashboard');
    const body = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(body).not.toContain('super-secret');
    expect(body).not.toContain('postgres://');
    expect(body).not.toContain('C:\\Users\\admin');
    expect(body).not.toContain('/home/runner');
    expect(response.body.errors.lastError).toContain('[REDACTED_CONNECTION_URL]');
  });

  it('redacts credentials embedded in any URL scheme', () => {
    const sanitized = sanitizeOperationalError('fetch failed https://admin:hunter2@api.example.com/v1');
    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).toContain('[REDACTED_CREDENTIALS]');
  });

  it('redacts sqlite and amqp connection strings', () => {
    expect(sanitizeOperationalError('sqlite:///var/data/iln.db')).toContain(
      '[REDACTED_CONNECTION_URL]'
    );
    expect(sanitizeOperationalError('amqp://guest:pass@rabbit:5672/')).toContain(
      '[REDACTED_CONNECTION_URL]'
    );
  });

  it('redacts Authorization bearer/basic/digest tokens', () => {
    const sanitized = sanitizeOperationalError(
      '401 Unauthorized - Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.token'
    );
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiJ9.token');
    expect(sanitized).toContain('[REDACTED_AUTH]');

    const basic = sanitizeOperationalError('Authorization: Basic dXNlcjpwYXNz');
    expect(basic).not.toContain('dXNlcjpwYXNz');

    const digest = sanitizeOperationalError('Authorization: Digest qop="auth" username="u"');
    expect(digest).not.toContain('qop');
  });

  it('redacts api keys, secrets, and passwords in key=value and key: value forms', () => {
    const cases = [
      'api_key=sk_live_abcdef123456',
      'API_KEY: sk_test_xyz',
      'token=abc.def.ghi',
      'secret=my-secret-value',
      'password=hunter2',
      'password: hunter2',
    ];
    for (const message of cases) {
      const sanitized = sanitizeOperationalError(message);
      // Never leak the raw value...
      for (const secret of ['sk_live_abcdef123456', 'sk_test_xyz', 'abc.def.ghi', 'my-secret-value', 'hunter2']) {
        expect(sanitized).not.toContain(secret);
      }
      // ...but keep the field name so the error is still diagnosable.
      expect(sanitized).toContain('[REDACTED]');
    }
  });

  it('redacts AWS-style access key ids', () => {
    const sanitized = sanitizeOperationalError('Access denied for AKIAIOSFODNN7EXAMPLE');
    expect(sanitized).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(sanitized).toContain('[REDACTED_AWS_KEY]');
  });

  it('redacts only the first line of a stack trace', () => {
    const sanitized = sanitizeOperationalError(
      'first line at /home/runner/app.ts:42\n at second (file:///var/tmp/leak.js:10)\n at third'
    );
    expect(sanitized).not.toContain('/home/runner');
    // Multi-line stack frames after the first line are dropped entirely.
    expect(sanitized).not.toContain('/var/tmp');
    expect(sanitized).not.toContain('second');
    expect(sanitized).not.toContain('third');
  });

  it('truncates long messages without leaking a trailing credential', () => {
    const message = `${'x'.repeat(500)} password=trailing-secret`;
    const sanitized = sanitizeOperationalError(message);
    expect(sanitized.length).toBeLessThanOrEqual(240);
    expect(sanitized).not.toContain('trailing-secret');
  });

  it('does not alter benign operational messages', () => {
    expect(sanitizeOperationalError('invoice 42 processed')).toBe('invoice 42 processed');
    expect(sanitizeOperationalError('sync lag: 5s')).toBe('sync lag: 5s');
  });

  it('is resilient to adversarial / injection-shaped error text', () => {
    const malicious = [
      // SQL injection attempt in a synthetic error
      "query failed: ' OR 1=1 -- ; DROP TABLE invoices",
      // Shell metacharacters
      'command failed: $(rm -rf /); `id`; && whoami',
      // Deeply nested / pathological strings must not crash the sanitizer
      'a'.repeat(10_000),
      '[{"nested":{"password":"p@ss","path":"/etc/passwd"}}]',
      '\u0000\u0001\u0002control chars',
    ];
    for (const text of malicious) {
      const sanitized = sanitizeOperationalError(text);
      expect(typeof sanitized).toBe('string');
      expect(sanitized.length).toBeLessThanOrEqual(240);
    }
    // Injection-shaped text is harmless: the sanitizer never executes it, only
    // bounds it. Nested credentials inside JSON payloads are still redacted.
    const json = sanitizeOperationalError('[{"nested":{"password":"p@ss"}}]');
    expect(json).not.toContain('p@ss');
    expect(json).toContain('[REDACTED]');
  });

  it('returns no database details when the metrics query fails', async () => {
    const db = createDb(':memory:');
    db.close();
    setDb(db);
    const response = await request(createApp()).get('/v1/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.sync.lastSyncLedger).toBeNull();
    expect(response.body.sync.lastSyncTime).toBeNull();
    // No raw error text, stack frames, or driver internals leak through.
    expect(JSON.stringify(response.body)).not.toMatch(/SQLITE|\.ts:\d+|node_modules|at \/|Cannot read|TypeError/i);
  });

  it('serves the same hardened payload from the unversioned legacy route', async () => {
    recordError('db', 'postgres://u:secret@h/db');
    const response = await request(createApp()).get('/dashboard');
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});

describe('dashboard access model', () => {
  it('is reachable without any credentials (public operational metrics)', async () => {
    const response = await request(createApp()).get('/v1/dashboard');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('sync');
    expect(response.body).toHaveProperty('performance');
    expect(response.body).toHaveProperty('errors');
    expect(response.body).toHaveProperty('uptime');
  });

  it('exposes only aggregated operational metrics - never row data', async () => {
    const response = await request(createApp()).get('/v1/dashboard');
    const body = JSON.stringify(response.body);
    // No invoice/event payloads, addresses, or other indexed data.
    expect(body).not.toMatch(/freelancer|payer|funder|"amount"|event_id|invoice_id/i);
  });
});
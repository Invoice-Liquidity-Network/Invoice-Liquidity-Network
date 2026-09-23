import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { createDb, setDb } from '../src/db';
import { recordError, resetMetrics } from '../src/dashboard';

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

  it('returns no database details when the metrics query fails', async () => {
    const db = createDb(':memory:');
    db.close();
    setDb(db);
    const response = await request(createApp()).get('/v1/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.sync.lastSyncLedger).toBeNull();
    expect(JSON.stringify(response.body)).not.toMatch(/SQLITE|\.ts:\d+|node_modules/i);
  });
});

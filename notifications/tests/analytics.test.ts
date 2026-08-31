process.env.NOTIFICATIONS_RPC_URL = 'http://localhost:8000';
process.env.NOTIFICATIONS_CONTRACT_ID = 'GTESTCONTRACT';
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.RESEND_API_KEY = 'test-api-key';

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/api';
import { createDb, setDb, logSentNotification } from '../src/db';

const app = createApp();

beforeEach(() => {
  setDb(createDb(':memory:'));
});

describe('GET /analytics', () => {
  it('returns 200 with the required shape when no data', async () => {
    const res = await request(app).get('/analytics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('byChannel');
    expect(res.body).toHaveProperty('byTrigger');
    expect(res.body.total).toBe(0);
  });

  it('total matches the number of seeded notifications', async () => {
    logSentNotification(1, 'invoice_funded', 'GABC', 'email', 'a@example.com');
    logSentNotification(2, 'invoice_paid', 'GABC', 'sms', '+14155550001');
    logSentNotification(3, 'invoice_funded', 'GDEF', 'webhook', 'https://example.com/hook');

    const res = await request(app).get('/analytics');
    expect(res.body.total).toBe(3);
  });

  it('byChannel groups counts correctly', async () => {
    logSentNotification(1, 'invoice_funded', 'GABC', 'email', 'a@example.com');
    logSentNotification(2, 'invoice_paid', 'GABC', 'email', 'b@example.com');
    logSentNotification(3, 'invoice_funded', 'GDEF', 'sms', '+14155550001');

    const res = await request(app).get('/analytics');
    expect(res.body.byChannel).toMatchObject({ email: 2, sms: 1 });
  });

  it('byTrigger groups counts correctly', async () => {
    logSentNotification(1, 'invoice_funded', 'GABC', 'email', 'a@example.com');
    logSentNotification(2, 'invoice_funded', 'GDEF', 'sms', '+14155550001');
    logSentNotification(3, 'invoice_paid', 'GABC', 'webhook', 'https://example.com/hook');

    const res = await request(app).get('/analytics');
    expect(res.body.byTrigger).toMatchObject({ invoice_funded: 2, invoice_paid: 1 });
  });
});

describe('GET /analytics/channel-comparison', () => {
  it('returns 200 with channels array', async () => {
    logSentNotification(1, 'invoice_funded', 'GABC', 'email', 'a@example.com');

    const res = await request(app).get('/analytics/channel-comparison');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.channels)).toBe(true);
  });

  it('each channel row has required fields', async () => {
    logSentNotification(1, 'invoice_funded', 'GABC', 'email', 'a@example.com');

    const res = await request(app).get('/analytics/channel-comparison');
    const row = res.body.channels[0];
    expect(row).toHaveProperty('channel');
    expect(row).toHaveProperty('sent');
    expect(row).toHaveProperty('failed');
    expect(row).toHaveProperty('successRate');
  });
});

describe('GET /analytics/trends', () => {
  it('returns 200 with trends array when no data', async () => {
    const res = await request(app).get('/analytics/trends');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.trends)).toBe(true);
  });

  it('returns trends for seeded data within window', async () => {
    logSentNotification(1, 'invoice_funded', 'GABC', 'email', 'a@example.com');
    logSentNotification(2, 'invoice_paid', 'GDEF', 'sms', '+14155550001');

    const res = await request(app).get('/analytics/trends?days=30');
    expect(res.status).toBe(200);
    expect(res.body.trends.length).toBeGreaterThan(0);
    expect(res.body.trends[0]).toHaveProperty('date');
    expect(res.body.trends[0]).toHaveProperty('count');
  });

  it('days=1 scopes to today only', async () => {
    logSentNotification(1, 'invoice_funded', 'GABC', 'email', 'a@example.com');

    const res = await request(app).get('/analytics/trends?days=1');
    expect(res.status).toBe(200);
    const total = res.body.trends.reduce((sum: number, r: { count: number }) => sum + r.count, 0);
    expect(total).toBe(1);
  });

  it('defaults to 30-day window when days param is omitted', async () => {
    const res = await request(app).get('/analytics/trends');
    expect(res.status).toBe(200);
  });
});

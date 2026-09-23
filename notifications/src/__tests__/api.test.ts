process.env.NOTIFICATIONS_RPC_URL = 'http://localhost:8000';
process.env.NOTIFICATIONS_CONTRACT_ID = 'GTESTCONTRACT';
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.RESEND_API_KEY = 'test-api-key';

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../api';
import { createDb, setDb } from '../db';

const app = createApp();

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = createDb(':memory:');
  setDb(db);
});

describe('Notification subscription API', () => {
  it('creates and lists subscriptions', async () => {
    const response = await request(app)
      .post('/subscribe')
      .send({
        stellar_address: 'GABCD1234',
        channel: 'email',
        destination: 'user@example.com',
        triggers: ['invoice_funded'],
      });

    expect(response.status).toBe(201);
    expect(response.body.subscription).toMatchObject({
      stellar_address: 'GABCD1234',
      channel: 'email',
      destination: 'user@example.com',
      triggers: ['invoice_funded'],
    });

    const list = await request(app).get('/subscriptions/GABCD1234');
    expect(list.status).toBe(200);
    expect(list.body.subscriptions).toHaveLength(1);
    expect(list.body.subscriptions[0].destination).toBe('user@example.com');
  });

  it('deletes a subscription by id', async () => {
    const create = await request(app)
      .post('/subscribe')
      .send({
        stellar_address: 'GABCD1234',
        channel: 'webhook',
        destination: 'https://example.com/webhook',
        triggers: ['invoice_paid'],
      });

    const id = create.body.subscription.id;
    const deleteResponse = await request(app).delete('/unsubscribe').send({ id });

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.success).toBe(true);

    const list = await request(app).get('/subscriptions/GABCD1234');
    expect(list.body.subscriptions).toHaveLength(0);
  });

  it('returns 400 for invalid subscription input', async () => {
    const response = await request(app)
      .post('/subscribe')
      .send({
        stellar_address: 'GABCD1234',
        channel: 'email',
        destination: 'not-an-email',
        triggers: ['invoice_funded'],
      });

    expect(response.status).toBe(400);
  });
});

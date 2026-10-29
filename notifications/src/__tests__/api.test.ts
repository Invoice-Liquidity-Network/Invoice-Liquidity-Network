process.env.NOTIFICATIONS_RPC_URL = 'http://localhost:8000';
process.env.NOTIFICATIONS_CONTRACT_ID = 'GTESTCONTRACT';
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.RESEND_API_KEY = 'test-api-key';

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { Keypair } from '@stellar/stellar-sdk';
import { createApp } from '../api';
import { createDb, setDb } from '../db';

const app = createApp();

let db: InstanceType<typeof Database>;
let owner: Keypair;

beforeEach(() => {
  db = createDb(':memory:');
  setDb(db);
  owner = Keypair.random();
});

async function signedProof(keypair: Keypair) {
  const res = await request(app)
    .post('/subscribe/challenge')
    .send({ stellar_address: keypair.publicKey() });
  expect(res.status).toBe(201);
  const { nonce, message } = res.body.challenge;
  return {
    challenge_nonce: nonce,
    signature: keypair.sign(Buffer.from(message, 'utf8')).toString('base64'),
  };
}

describe('Notification subscription API', () => {
  it('creates and lists subscriptions', async () => {
    const response = await request(app)
      .post('/subscribe')
      .send({
        stellar_address: owner.publicKey(),
        channel: 'email',
        destination: 'user@example.com',
        triggers: ['invoice_funded'],
        ...(await signedProof(owner)),
      });

    expect(response.status).toBe(201);
    expect(response.body.subscription).toMatchObject({
      stellar_address: owner.publicKey(),
      channel: 'email',
      destination: 'user@example.com',
      triggers: ['invoice_funded'],
    });
    expect(response.body.subscription.ownership_verified_at).toEqual(expect.any(Number));

    const list = await request(app).get(`/subscriptions/${owner.publicKey()}`);
    expect(list.status).toBe(200);
    expect(list.body.subscriptions).toHaveLength(1);
    expect(list.body.subscriptions[0].destination).toBe('user@example.com');
    expect(list.body.subscriptions[0].ownership_verified).toBe(true);
  });

  it('deletes a subscription by id', async () => {
    const create = await request(app)
      .post('/subscribe')
      .send({
        stellar_address: owner.publicKey(),
        channel: 'webhook',
        destination: 'https://example.com/webhook',
        triggers: ['invoice_paid'],
        ...(await signedProof(owner)),
      });

    const id = create.body.subscription.id;
    const deleteResponse = await request(app).delete('/unsubscribe').send({ id });

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.success).toBe(true);

    const list = await request(app).get(`/subscriptions/${owner.publicKey()}`);
    expect(list.body.subscriptions).toHaveLength(0);
  });

  it('returns 400 for invalid subscription input', async () => {
    const response = await request(app)
      .post('/subscribe')
      .send({
        stellar_address: owner.publicKey(),
        channel: 'email',
        destination: 'not-an-email',
        triggers: ['invoice_funded'],
      });

    expect(response.status).toBe(400);
  });
});

describe('Subscription address ownership verification (#1281)', () => {
  const base = {
    channel: 'email',
    destination: 'user@example.com',
    triggers: ['invoice_funded'],
  };

  it('rejects a subscription without an ownership proof', async () => {
    const res = await request(app)
      .post('/subscribe')
      .send({ ...base, stellar_address: owner.publicKey() });

    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('missing_proof');
    const list = await request(app).get(`/subscriptions/${owner.publicKey()}`);
    expect(list.body.subscriptions).toHaveLength(0);
  });

  it('rejects a subscription for another address signed by a different key', async () => {
    const victim = Keypair.random();
    const challenge = await request(app)
      .post('/subscribe/challenge')
      .send({ stellar_address: victim.publicKey() });
    const attackerSignature = owner
      .sign(Buffer.from(challenge.body.challenge.message, 'utf8'))
      .toString('base64');

    const res = await request(app)
      .post('/subscribe')
      .send({
        ...base,
        stellar_address: victim.publicKey(),
        challenge_nonce: challenge.body.challenge.nonce,
        signature: attackerSignature,
      });

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('invalid_signature');
  });

  it('rejects a replayed proof', async () => {
    const proof = await signedProof(owner);
    const first = await request(app)
      .post('/subscribe')
      .send({ ...base, stellar_address: owner.publicKey(), ...proof });
    const replay = await request(app)
      .post('/subscribe')
      .send({
        ...base,
        destination: 'second@example.com',
        stellar_address: owner.publicKey(),
        ...proof,
      });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(403);
    expect(replay.body.reason).toBe('replayed');
  });

  it('rejects a challenge issued for a different address', async () => {
    const other = Keypair.random();
    const proof = await signedProof(other);
    const res = await request(app)
      .post('/subscribe')
      .send({ ...base, stellar_address: owner.publicKey(), ...proof });

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('address_mismatch');
  });

  it('rejects malformed Stellar addresses before issuing a challenge', async () => {
    const res = await request(app)
      .post('/subscribe/challenge')
      .send({ stellar_address: 'GABCD1234' });
    expect(res.status).toBe(400);
  });

  it('fails closed with 503 when the challenge store is unavailable', async () => {
    const proof = await signedProof(owner);
    db.close();

    const res = await request(app)
      .post('/subscribe')
      .send({ ...base, stellar_address: owner.publicKey(), ...proof });

    expect(res.status).toBe(503);
  });

  it('re-verifies legacy subscriptions via POST /subscriptions/verify', async () => {
    db.prepare(
      `INSERT INTO subscriptions (stellar_address, channel, destination, triggers, created_at)
       VALUES (?, 'email', 'legacy@example.com', '["invoice_funded"]', ?)`
    ).run(owner.publicKey(), Date.now());

    const before = await request(app).get('/metrics/ownership');
    expect(before.body.unverifiedSubscriptions).toBe(1);

    const res = await request(app)
      .post('/subscriptions/verify')
      .send({ stellar_address: owner.publicKey(), ...(await signedProof(owner)) });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(1);
    const after = await request(app).get('/metrics/ownership');
    expect(after.body.unverifiedSubscriptions).toBe(0);
    expect(after.body.control).toBe('notification-address-ownership-verification');
  });
});

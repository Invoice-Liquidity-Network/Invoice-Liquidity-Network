/**
 * Operator-facing coverage for issue #1060: dead-letter queue inspection,
 * manual replay, and accumulation alerting in `src/delivery.ts`, plus the
 * `/dead-letter` HTTP routes in `src/api.ts`.
 *
 * `tests/delivery-retry.test.ts` covers retry counts, backoff gaps, and that
 * exhausted sends land in the queue. This file covers what happens next:
 * stable entry ids, listing, replay (success and re-failure), the unknown-id
 * error path, the DLQ accumulation warning, and the HTTP surface operators use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { MAX_RETRIES, emailSend, smsCreate, twilioFactory, createLog, updateLog } = vi.hoisted(
  () => ({
    MAX_RETRIES: 3,
    emailSend: vi.fn(),
    smsCreate: vi.fn(),
    twilioFactory: vi.fn(),
    createLog: vi.fn(),
    updateLog: vi.fn(),
  })
);

vi.mock('../src/config', () => ({
  CONFIG: {
    resendApiKey: 'test-key',
    resendFromEmail: 'no-reply@example.com',
    twilioAccountSid: 'AC123',
    twilioAuthToken: 'auth-token',
    twilioFromNumber: '+15551234567',
    maxWebhookRetry: MAX_RETRIES,
    webhookBackoffBaseMs: 500,
  },
}));

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: emailSend } };
  }),
}));

vi.mock('twilio', () => ({ default: twilioFactory }));

vi.mock('../src/db', () => ({
  createWebhookDeliveryLog: createLog,
  updateWebhookDeliveryLog: updateLog,
  createSubscription: vi.fn(),
  deleteSubscriptionById: vi.fn(),
  deleteSubscriptionByAddressAndDestination: vi.fn(),
  getSubscriptionsByAddress: vi.fn(() => []),
  getSubscriptionById: vi.fn(() => undefined),
  getWebhookDeliveryLogs: vi.fn(() => []),
  getDeliveryAnalytics: vi.fn(() => ({})),
  getChannelComparison: vi.fn(() => []),
  getTrendAnalytics: vi.fn(() => []),
}));

import request from 'supertest';
import {
  DLQ_ALERT_THRESHOLD,
  clearDeadLetterQueue,
  getDeadLetterCount,
  getDeadLetterEntries,
  replayDeadLetter,
  sendEmail,
} from '../src/delivery';
import { createApp } from '../src/api';

function makeSubscription(overrides: Record<string, any> = {}) {
  return {
    id: 7,
    stellar_address: 'GSUBSCRIBER',
    channel: 'email' as const,
    destination: 'freelancer@example.com',
    triggers: ['invoice_funded' as const],
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function makePayload(overrides: Record<string, any> = {}) {
  return {
    trigger: 'invoice_funded' as const,
    invoice: {
      id: 42,
      freelancer: 'GFREELANCER',
      payer: 'GPAYER',
      amount: '100000000',
      due_date: 1_700_086_400,
      discount_rate: 300,
      status: 'Funded' as const,
      funder: 'GFUNDER',
      funded_at: 1_700_000_000,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
    },
    recipientAddress: 'GFREELANCER',
    subject: 'Invoice #42 funded',
    message: 'Your invoice has been funded',
    actor: 'freelancer' as const,
    eventId: 'evt-42-funded',
    eventType: 'funded' as const,
    ...overrides,
  };
}

async function deadLetterOneEmail() {
  emailSend.mockRejectedValue(new Error('provider down'));
  const promise = sendEmail(makeSubscription(), makePayload());
  const assertion = expect(promise).rejects.toThrow('provider down');
  await vi.runAllTimersAsync();
  await assertion;
}

beforeEach(() => {
  vi.useFakeTimers();
  clearDeadLetterQueue();
  emailSend.mockReset().mockResolvedValue({ id: 'email-1' });
  smsCreate.mockReset().mockResolvedValue({ sid: 'SM123', status: 'queued' });
  twilioFactory.mockReturnValue({ messages: { create: smsCreate } });
  createLog.mockReturnValue({ id: 99 });
  updateLog.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('dead-letter entry identity', () => {
  it('assigns a stable operator-facing id to every entry', async () => {
    await deadLetterOneEmail();
    const [entry] = getDeadLetterEntries();
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.timestamp).toBe('number');
  });

  it('hands out copies so consumers cannot corrupt the queue', async () => {
    await deadLetterOneEmail();
    const snapshot = getDeadLetterEntries();
    snapshot.length = 0;
    expect(getDeadLetterCount()).toBe(1);
  });
});

describe('replayDeadLetter', () => {
  it('removes the entry and redelivers it successfully', async () => {
    await deadLetterOneEmail();
    const [entry] = getDeadLetterEntries();
    expect(getDeadLetterCount()).toBe(1);

    emailSend.mockResolvedValue({ id: 'email-replayed' });
    replayDeadLetter(entry.id);
    expect(getDeadLetterCount()).toBe(0);

    await vi.runAllTimersAsync();
    expect(emailSend).toHaveBeenCalled();
    expect(getDeadLetterCount()).toBe(0);
  });

  it('re-queues a single entry when replay fails', async () => {
    await deadLetterOneEmail();
    const [entry] = getDeadLetterEntries();

    emailSend.mockRejectedValue(new Error('still down'));
    replayDeadLetter(entry.id);
    await vi.runAllTimersAsync();

    // Exactly one entry: the redelivery exhausts retries and dead-letters
    // internally; the replay path must not double-queue the same failure.
    expect(getDeadLetterCount()).toBe(1);
    const [requeued] = getDeadLetterEntries();
    expect(requeued.lastError).toBe('still down');
  });

  it('throws for an unknown entry id', () => {
    expect(() => replayDeadLetter('no-such-id')).toThrow(/not found/);
  });
});

describe('dead-letter accumulation alerting', () => {
  it(`warns once the queue exceeds DLQ_ALERT_THRESHOLD (${DLQ_ALERT_THRESHOLD})`, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    emailSend.mockRejectedValue(new Error('provider down'));

    for (let i = 0; i <= DLQ_ALERT_THRESHOLD; i += 1) {
      const promise = sendEmail(
        makeSubscription({ destination: `user${i}@example.com` }),
        makePayload()
      );
      const assertion = expect(promise).rejects.toThrow('provider down');
      await vi.runAllTimersAsync();
      await assertion;
    }

    expect(getDeadLetterCount()).toBe(DLQ_ALERT_THRESHOLD + 1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DLQ ALERT]'));
  });
});

describe('dead-letter HTTP routes', () => {
  it('GET /dead-letter lists entries with a count', async () => {
    await deadLetterOneEmail();
    // supertest drives a real in-process HTTP server; use real timers here.
    vi.useRealTimers();
    try {
      const res = await request(createApp()).get('/dead-letter');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].lastError).toBe('provider down');
    } finally {
      vi.useFakeTimers();
    }
  });

  it('GET /dead-letter/metrics exposes retry metrics', async () => {
    await deadLetterOneEmail();
    vi.useRealTimers();
    try {
      const res = await request(createApp()).get('/dead-letter/metrics');
      expect(res.status).toBe(200);
      expect(res.body.deadLetterCount).toBe(1);
      expect(res.body.totalRetries).toBeGreaterThan(0);
    } finally {
      vi.useFakeTimers();
    }
  });

  it('POST /dead-letter/:id/replay replays and 404s on unknown ids', async () => {
    await deadLetterOneEmail();
    const [entry] = getDeadLetterEntries();
    emailSend.mockResolvedValue({ id: 'email-replayed' });

    vi.useRealTimers();
    try {
      const app = createApp();
      const ok = await request(app).post(`/dead-letter/${entry.id}/replay`);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ success: true, id: entry.id });

      const missing = await request(app).post('/dead-letter/no-such-id/replay');
      expect(missing.status).toBe(404);
    } finally {
      vi.useFakeTimers();
    }
  });
});

/**
 * Failure-path coverage for `src/delivery.ts` — the layer that actually talks to
 * Resend, Twilio, and subscriber webhook endpoints.
 *
 * `tests/delivery.test.ts` covers the happy path through `NotificationService`.
 * This file covers what happens when the provider is down: how many times a
 * send is retried, how long it waits between attempts, and where a permanently
 * failed notification ends up so it is not silently dropped.
 *
 * Timers are faked so the assertions on exponential backoff measure the delay
 * the caller would actually observe (via `Date.now()` inside the mocked
 * provider) rather than a spy on `setTimeout`.
 *
 * Known gap, deliberately asserted rather than fixed here: the dead-letter
 * queue is an in-process array. It does not survive a restart, is unbounded,
 * and nothing alerts on it or redelivers from it. See the tests under
 * "dead-letter queue" and the follow-up issue referenced in the PR.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted alongside the mocks because `vi.mock` factories run before any
// top-level `const`. The retry values mirror the real CONFIG defaults
// (`maxWebhookRetry: 3`, `webhookBackoffBaseMs: 500`) in src/config.ts.
const { MAX_RETRIES, BACKOFF_BASE_MS, emailSend, smsCreate, twilioFactory, createLog, updateLog, dnsLookup } =
  vi.hoisted(() => ({
    MAX_RETRIES: 3,
    BACKOFF_BASE_MS: 500,
    emailSend: vi.fn(),
    smsCreate: vi.fn(),
    twilioFactory: vi.fn(),
    createLog: vi.fn(),
    updateLog: vi.fn(),
    dnsLookup: vi.fn(),
  }));

vi.mock('../src/config', () => ({
  CONFIG: {
    resendApiKey: 'test-key',
    resendFromEmail: 'no-reply@example.com',
    twilioAccountSid: 'AC123',
    twilioAuthToken: 'auth-token',
    twilioFromNumber: '+15551234567',
    maxWebhookRetry: MAX_RETRIES,
    webhookBackoffBaseMs: BACKOFF_BASE_MS,
  },
}));

// `sendWebhook` validates every outbound target against SSRF by resolving the
// hostname at delivery time. Mock DNS so hostnames resolve to a public IP by
// default; the SSRF tests below override this to simulate private/rbind targets.
vi.mock('node:dns/promises', () => ({
  lookup: dnsLookup,
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
}));

import {
  clearDeadLetterQueue,
  deliverNotification,
  getRetryMetrics,
  getCircuitBreakerState,
  resetCircuitBreakers,
  sendEmail,
  sendSms,
  sendWebhook,
} from '../src/delivery';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WEBHOOK_URL = 'https://subscriber.example.com/iln';

/**
 * `src/delivery.ts` is typed against `Subscription` but reads `destination`,
 * `webhook_secret`, and a `"sms"` channel — i.e. the `LegacySubscription` shape.
 * The fixtures follow the shape the code actually uses at runtime.
 */
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

/**
 * Records, per call, how much time has elapsed since the send was initiated.
 * The gaps between consecutive entries are the backoff the caller observed.
 */
function elapsedRecorder() {
  const start = Date.now();
  const at: number[] = [];
  return {
    at,
    mark: () => at.push(Date.now() - start),
    /** Gaps between successive attempts. */
    gaps: () => at.slice(1).map((time, index) => time - at[index]),
  };
}

/**
 * Drive a send that is expected to fail.
 *
 * The rejection assertion is attached before the fake timers are drained: the
 * send rejects part-way through draining, and a promise with no handler yet
 * attached surfaces as an unhandled rejection rather than a test failure.
 */
async function expectSendToReject(promise: Promise<unknown>, message: string) {
  const assertion = expect(promise).rejects.toThrow(message);
  await vi.runAllTimersAsync();
  await assertion;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  clearDeadLetterQueue();
  resetCircuitBreakers();

  emailSend.mockResolvedValue({ id: 'email-1' });
  smsCreate.mockResolvedValue({ sid: 'SM123', status: 'queued' });
  twilioFactory.mockReturnValue({ messages: { create: smsCreate } });
  createLog.mockReturnValue({ id: 99 });
  updateLog.mockResolvedValue(undefined);

  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);

  dnsLookup.mockReset();
  dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── Email ────────────────────────────────────────────────────────────────────

describe('sendEmail failure handling', () => {
  it('retries a transient provider failure and succeeds without dead-lettering', async () => {
    emailSend
      .mockRejectedValueOnce(new Error('provider 503'))
      .mockResolvedValueOnce({ id: 'email-2' });

    const promise = sendEmail(makeSubscription(), makePayload());
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(getRetryMetrics().deadLetterCount).toBe(0);
  });

  it('gives up after CONFIG.maxWebhookRetry attempts and rejects', async () => {
    emailSend.mockRejectedValue(new Error('provider down'));

    await expectSendToReject(sendEmail(makeSubscription(), makePayload()), 'provider down');

    expect(emailSend).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  it('waits an exponentially increasing time between attempts', async () => {
    const recorder = elapsedRecorder();
    emailSend.mockImplementation(async () => {
      recorder.mark();
      throw new Error('timeout');
    });

    await expectSendToReject(sendEmail(makeSubscription(), makePayload()), 'timeout');

    // base * 2^(attempt - 1): 500ms before attempt 2, 1000ms before attempt 3.
    expect(recorder.gaps()).toEqual([BACKOFF_BASE_MS, BACKOFF_BASE_MS * 2]);
  });

  it('dead-letters the notification with the context needed to redeliver it', async () => {
    emailSend.mockRejectedValue(new Error('mailbox unavailable'));

    const subscription = makeSubscription({ id: 'sub-email-1', destination: 'lp@example.com' });
    const payload = makePayload();

    await expectSendToReject(sendEmail(subscription, payload), 'mailbox unavailable');

    const { deadLetterEntries } = getRetryMetrics();
    expect(deadLetterEntries).toHaveLength(1);
    expect(deadLetterEntries[0]).toMatchObject({
      channel: 'email',
      destination: 'lp@example.com',
      subscriptionId: 'sub-email-1',
      trigger: payload.trigger,
      subject: payload.subject,
      message: payload.message,
      lastError: 'mailbox unavailable',
      attempts: MAX_RETRIES,
    });
    expect(deadLetterEntries[0].invoice).toEqual(payload.invoice);
    expect(typeof deadLetterEntries[0].timestamp).toBe('number');
  });

  it('propagates the failure through deliverNotification so the caller can react', async () => {
    emailSend.mockRejectedValue(new Error('provider down'));

    await expectSendToReject(
      deliverNotification(makeSubscription({ channel: 'email' }), makePayload()),
      'provider down'
    );
  });
});

// ─── SMS ──────────────────────────────────────────────────────────────────────

describe('sendSms failure handling', () => {
  it('retries with the same policy as email and rejects once exhausted', async () => {
    const recorder = elapsedRecorder();
    smsCreate.mockImplementation(async () => {
      recorder.mark();
      throw new Error('twilio 500');
    });

    await expectSendToReject(
      sendSms(makeSubscription({ channel: 'sms', destination: '+15559876543' }), makePayload()),
      'twilio 500'
    );

    expect(smsCreate).toHaveBeenCalledTimes(MAX_RETRIES);
    expect(recorder.gaps()).toEqual([BACKOFF_BASE_MS, BACKOFF_BASE_MS * 2]);
  });

  it('dead-letters permanently failed messages under the sms channel', async () => {
    smsCreate.mockRejectedValue(new Error('unreachable handset'));

    await expectSendToReject(
      sendSms(
        makeSubscription({ id: 'sub-sms-1', channel: 'sms', destination: '+15559876543' }),
        makePayload()
      ),
      'unreachable handset'
    );

    expect(getRetryMetrics().deadLetterEntries).toHaveLength(1);
    expect(getRetryMetrics().deadLetterEntries[0]).toMatchObject({
      channel: 'sms',
      destination: '+15559876543',
      subscriptionId: 'sub-sms-1',
      lastError: 'unreachable handset',
      attempts: MAX_RETRIES,
    });
  });
});

// ─── Webhook ──────────────────────────────────────────────────────────────────

describe('sendWebhook failure handling', () => {
  const webhookSub = () =>
    makeSubscription({ id: 3, channel: 'webhook', destination: WEBHOOK_URL });

  it('retries a 5xx response and marks the delivery log successful once it lands', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const promise = sendWebhook(webhookSub(), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(updateLog).toHaveBeenCalledWith(99, { status: 'success' });
    expect(getRetryMetrics().deadLetterCount).toBe(0);
  });

  it('retries a network-level error, not just a bad status code', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const promise = sendWebhook(webhookSub(), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially between attempts', async () => {
    const recorder = elapsedRecorder();
    fetchMock.mockImplementation(async () => {
      recorder.mark();
      return { ok: false, status: 500 };
    });

    const promise = sendWebhook(webhookSub(), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(recorder.gaps()).toEqual([BACKOFF_BASE_MS, BACKOFF_BASE_MS * 2]);
  });

  it('reuses one delivery log row across every attempt', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const promise = sendWebhook(webhookSub(), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(createLog).toHaveBeenCalledTimes(1);
    for (const call of updateLog.mock.calls) {
      expect(call[0]).toBe(99);
    }
  });

  it('marks the delivery log failed and dead-letters after the final attempt', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const promise = sendWebhook(webhookSub(), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES);
    expect(updateLog).toHaveBeenCalledWith(99, {
      status: 'failed',
      attempts: MAX_RETRIES,
      error: 'HTTP 500',
    });

    const { deadLetterEntries } = getRetryMetrics();
    expect(deadLetterEntries).toHaveLength(1);
    expect(deadLetterEntries[0]).toMatchObject({
      channel: 'webhook',
      destination: WEBHOOK_URL,
      lastError: 'HTTP 500',
      attempts: MAX_RETRIES,
    });
  });

  it('records the network error message when the request never completes', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));

    const promise = sendWebhook(webhookSub(), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(getRetryMetrics().deadLetterEntries[0].lastError).toBe('ETIMEDOUT');
  });

  it('resolves rather than rejects once retries are exhausted', async () => {
    // Asymmetry with email/SMS, which reject: a caller awaiting
    // deliverNotification for a webhook subscription cannot tell from the
    // return value that delivery failed, only from the dead-letter queue.
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const promise = deliverNotification(webhookSub(), makePayload());
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    expect(getRetryMetrics().deadLetterCount).toBe(1);
  });
});

// ─── SSRF rejection ───────────────────────────────────────────────────────────

describe('sendWebhook SSRF rejection', () => {
  const webhookSub = (destination: string) =>
    makeSubscription({ id: 3, channel: 'webhook', destination });

  it('refuses an IP-literal pointing at a private range before any request', async () => {
    const promise = sendWebhook(webhookSub('http://169.254.169.254/latest/meta-data/'), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateLog).toHaveBeenCalledWith(99, {
      status: 'failed',
      attempts: 1,
      error: expect.stringContaining('169.254.0.0/16'),
    });
    expect(getRetryMetrics().deadLetterEntries).toHaveLength(1);
    expect(getRetryMetrics().deadLetterEntries[0]).toMatchObject({
      channel: 'webhook',
      lastError: expect.stringContaining('169.254.0.0/16'),
    });
  });

  it('refuses a hostname that resolves to a private IP (DNS rebinding)', async () => {
    dnsLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    const promise = sendWebhook(webhookSub('https://rebind.example.com/hook'), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateLog).toHaveBeenCalledWith(99, {
      status: 'failed',
      attempts: 1,
      error: expect.stringContaining('10.0.0.0/8'),
    });
    expect(getRetryMetrics().deadLetterEntries[0].lastError).toContain('rebind.example.com');
  });

  it('refuses a hostname when any of several resolved addresses is private', async () => {
    dnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '::ffff:127.0.0.1', family: 6 },
    ]);

    const promise = sendWebhook(webhookSub('https://mix.example.com/hook'), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getRetryMetrics().deadLetterEntries[0].lastError).toContain('loopback');
  });

  it('refuses a non-http(s) scheme', async () => {
    const promise = sendWebhook(webhookSub('file:///etc/passwd'), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getRetryMetrics().deadLetterEntries[0].lastError).toContain('http or https');
  });

  it('refuses an unresolvable hostname instead of falling through to fetch', async () => {
    dnsLookup.mockRejectedValue(new Error('ENOTFOUND'));

    const promise = sendWebhook(webhookSub('https://does-not-exist.example.com/hook'), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getRetryMetrics().deadLetterEntries[0].lastError).toContain('DNS resolution');
  });

  it('still delivers to a public target after hardening', async () => {
    const promise = sendWebhook(webhookSub(WEBHOOK_URL), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateLog).toHaveBeenCalledWith(99, { status: 'success' });
    expect(getRetryMetrics().deadLetterCount).toBe(0);
  });
});

// ─── Dead-letter queue ────────────────────────────────────────────────────────

describe('dead-letter queue', () => {
  it('accumulates failures across channels so nothing is dropped silently', async () => {
    emailSend.mockRejectedValue(new Error('email down'));
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expectSendToReject(sendEmail(makeSubscription(), makePayload()), 'email down');

    const webhook = sendWebhook(
      makeSubscription({ channel: 'webhook', destination: WEBHOOK_URL }),
      makePayload()
    );
    await vi.runAllTimersAsync();
    await webhook;

    const { deadLetterCount, deadLetterEntries } = getRetryMetrics();
    expect(deadLetterCount).toBe(2);
    expect(deadLetterEntries.map((entry) => entry.channel)).toEqual(['email', 'webhook']);
  });

  it('counts retries so a degraded provider is visible in metrics', async () => {
    emailSend.mockRejectedValueOnce(new Error('flaky')).mockResolvedValueOnce({ id: 'email-3' });

    const promise = sendEmail(makeSubscription(), makePayload());
    await vi.runAllTimersAsync();
    await promise;

    expect(getRetryMetrics().totalRetries).toBeGreaterThan(0);
  });

  it('hands out a copy, so a consumer draining the queue cannot corrupt it', async () => {
    emailSend.mockRejectedValue(new Error('email down'));

    await expectSendToReject(sendEmail(makeSubscription(), makePayload()), 'email down');

    const snapshot = getRetryMetrics().deadLetterEntries;
    snapshot.length = 0;

    expect(getRetryMetrics().deadLetterCount).toBe(1);
  });

  it('is cleared only explicitly — entries persist until something drains them', async () => {
    emailSend.mockRejectedValue(new Error('email down'));

    await expectSendToReject(sendEmail(makeSubscription(), makePayload()), 'email down');

    expect(getRetryMetrics().deadLetterCount).toBe(1);

    clearDeadLetterQueue();

    // Nothing in the service persists or re-delivers these entries first: the
    // queue lives in process memory only, so clearing it (or restarting the
    // process) discards the failed notifications outright.
    expect(getRetryMetrics().deadLetterCount).toBe(0);
  });
});

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

describe('circuit breaker', () => {
  it('stays closed after a successful delivery', async () => {
    const sub = makeSubscription({ destination: 'good@example.com' });
    await sendEmail(sub, makePayload());

    expect(getCircuitBreakerState('good@example.com')).toBe('closed');
  });

  it('stays closed with fewer failures than the threshold', async () => {
    emailSend.mockRejectedValue(new Error('transient'));
    const sub = makeSubscription({ destination: 'flaky@example.com' });

    // Fail 4 times (threshold is 5)
    for (let i = 0; i < 4; i++) {
      try {
        await sendEmail(sub, makePayload());
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState('flaky@example.com')).toBe('closed');
  });

  it('opens after the failure threshold is reached', async () => {
    emailSend.mockRejectedValue(new Error('persistent'));
    const sub = makeSubscription({ destination: 'bad@example.com' });

    // Fail 5 times (threshold is 5)
    for (let i = 0; i < 5; i++) {
      try {
        await sendEmail(sub, makePayload());
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState('bad@example.com')).toBe('open');
  });

  it('skips delivery when circuit is open', async () => {
    emailSend.mockRejectedValue(new Error('down'));
    const sub = makeSubscription({ destination: 'open@example.com' });

    // Trip the circuit breaker
    for (let i = 0; i < 5; i++) {
      try {
        await sendEmail(sub, makePayload());
      } catch {
        // expected
      }
    }

    // Circuit is open — should skip without calling the provider
    emailSend.mockClear();
    await sendEmail(sub, makePayload());

    expect(emailSend).not.toHaveBeenCalled();
  });

  it('transitions to half-open after the reset timeout', async () => {
    vi.useFakeTimers();
    emailSend.mockRejectedValue(new Error('down'));
    const sub = makeSubscription({ destination: 'timeout@example.com' });

    // Trip the circuit breaker
    for (let i = 0; i < 5; i++) {
      try {
        await sendEmail(sub, makePayload());
      } catch {
        // expected
      }
    }

    expect(getCircuitBreakerState('timeout@example.com')).toBe('open');

    // Advance past the reset timeout (60 seconds)
    vi.advanceTimersByTime(60_000);

    // Circuit should now be half-open and allow a probe request
    emailSend.mockResolvedValue({ id: 'probe-ok' });
    await sendEmail(sub, makePayload());

    // Successful probe closes the circuit
    expect(getCircuitBreakerState('timeout@example.com')).toBe('closed');
    vi.useRealTimers();
  });

  it('resets circuit on success after half-open probe', async () => {
    vi.useFakeTimers();
    const sub = makeSubscription({ destination: 'recover@example.com' });

    // Trip the circuit
    emailSend.mockRejectedValue(new Error('down'));
    for (let i = 0; i < 5; i++) {
      try { await sendEmail(sub, makePayload()); } catch { /* expected */ }
    }
    expect(getCircuitBreakerState('recover@example.com')).toBe('open');

    // Advance past reset timeout
    vi.advanceTimersByTime(60_000);

    // Probe succeeds
    emailSend.mockResolvedValue({ id: 'recovered' });
    await sendEmail(sub, makePayload());

    expect(getCircuitBreakerState('recover@example.com')).toBe('closed');
    vi.useRealTimers();
  });

  it('records webhook circuit breaker on exhausted retries', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const sub = makeSubscription({ id: 3, channel: 'webhook', destination: 'https://fail.example.com/hook' });

    await sendWebhook(sub, makePayload());
    await vi.runAllTimersAsync();

    expect(getCircuitBreakerState('https://fail.example.com/hook')).toBe('open');
  });

  it('isolates circuit breakers per destination', async () => {
    emailSend.mockRejectedValue(new Error('down'));
    const bad = makeSubscription({ destination: 'bad-isolated@example.com' });
    const good = makeSubscription({ destination: 'good-isolated@example.com' });

    // Trip the circuit for bad@example.com
    for (let i = 0; i < 5; i++) {
      try { await sendEmail(bad, makePayload()); } catch { /* expected */ }
    }

    // good@example.com is unaffected
    emailSend.mockResolvedValue({ id: 'ok' });
    await sendEmail(good, makePayload());

    expect(getCircuitBreakerState('bad-isolated@example.com')).toBe('open');
    expect(getCircuitBreakerState('good-isolated@example.com')).toBe('closed');
  });

  it('permanently-failing destination stops consuming retries after circuit opens', async () => {
    // Scenario: a webhook destination is permanently down (always returns 500).
    // After the failure threshold is reached, the circuit opens and subsequent
    // delivery attempts are skipped — retry volume for that destination drops
    // to near-zero.
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const failingSub = makeSubscription({
      id: 3,
      channel: 'webhook',
      destination: 'https://permanently-down.example.com/hook',
    });

    // First batch: 3 attempts (maxWebhookRetry) exhaust retries, circuit opens
    await sendWebhook(failingSub, makePayload());
    await vi.runAllTimersAsync();

    // Circuit is open — next delivery attempt should be skipped entirely
    fetchMock.mockClear();
    await sendWebhook(failingSub, makePayload());
    await vi.runAllTimersAsync();

    // fetch was NOT called — circuit breaker prevented the retry
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCircuitBreakerState('https://permanently-down.example.com/hook')).toBe('open');
  });

  it('other destinations continue normal delivery while one destination is circuit-broken', async () => {
    // Simulate two webhook destinations: one permanently down, one healthy.
    // The healthy destination should continue receiving deliveries normally.
    const badUrl = 'https://down.example.com/hook';
    const goodUrl = 'https://healthy.example.com/hook';

    // Set up: bad always fails, good always succeeds
    fetchMock.mockImplementation(async (url: string) => {
      if (url === badUrl) {
        return { ok: false, status: 500 };
      }
      return { ok: true, status: 200 };
    });

    const badSub = makeSubscription({ id: 10, channel: 'webhook', destination: badUrl });
    const goodSub = makeSubscription({ id: 11, channel: 'webhook', destination: goodUrl });

    // Trip the circuit for badUrl (3 attempts × 1 full retry cycle each)
    for (let i = 0; i < 3; i++) {
      await sendWebhook(badSub, makePayload());
      await vi.runAllTimersAsync();
    }
    expect(getCircuitBreakerState(badUrl)).toBe('open');

    // goodUrl should still work — independent circuit breaker
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === badUrl) return { ok: false, status: 500 };
      return { ok: true, status: 200 };
    });

    await sendWebhook(goodSub, makePayload());
    await vi.runAllTimersAsync();

    // goodUrl got its delivery; badUrl was skipped
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(goodUrl, expect.anything());
    expect(getCircuitBreakerState(goodUrl)).toBe('closed');
  });

  it('circuit breaker records failure after all retries exhausted for webhook', async () => {
    // Verifies that the circuit breaker failure count is recorded once per
    // full retry exhaustion, not once per individual attempt.
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const sub = makeSubscription({
      id: 3,
      channel: 'webhook',
      destination: 'https://count.example.com/hook',
    });

    // First full retry cycle: 3 attempts, circuit records 1 failure
    await sendWebhook(sub, makePayload());
    await vi.runAllTimersAsync();
    expect(getCircuitBreakerState('https://count.example.com/hook')).toBe('closed');

    // Second full retry cycle: 3 more attempts, circuit records 2nd failure
    await sendWebhook(sub, makePayload());
    await vi.runAllTimersAsync();
    expect(getCircuitBreakerState('https://count.example.com/hook')).toBe('closed');

    // Third full retry cycle: 3 more attempts, circuit records 3rd failure
    await sendWebhook(sub, makePayload());
    await vi.runAllTimersAsync();
    expect(getCircuitBreakerState('https://count.example.com/hook')).toBe('closed');

    // Fourth full retry cycle: circuit reaches threshold (5) and opens
    await sendWebhook(sub, makePayload());
    await vi.runAllTimersAsync();
    expect(getCircuitBreakerState('https://count.example.com/hook')).toBe('open');

    // Subsequent attempts are skipped
    fetchMock.mockClear();
    await sendWebhook(sub, makePayload());
    await vi.runAllTimersAsync();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

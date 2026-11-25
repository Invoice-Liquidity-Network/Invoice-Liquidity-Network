process.env.NOTIFICATIONS_RPC_URL = 'http://localhost:8000';
process.env.NOTIFICATIONS_CONTRACT_ID = 'GTESTCONTRACT';
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.RESEND_API_KEY = 're_test_secret_resend_api_key_12345';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDb, setDb, createSubscription } from '../src/db';
import {
  resetProviderHealth,
  simulateProviderOutage,
  restoreProvider,
  getProviderHealth,
  fallbackCapacityLimiter,
} from '../src/provider-health';
import {
  deliverWithFallback,
  assertCredentialIsolation,
  buildDeliveryDedupeKey,
  isDeliveryDuplicate,
  markDeliverySent,
  resetFallbackDedupe,
} from '../src/fallback';
import { clearDeadLetterQueue, resetCircuitBreakers } from '../src/delivery';

const { emailSend, smsCreate, twilioFactory, dnsLookup } = vi.hoisted(() => ({
  emailSend: vi.fn(),
  smsCreate: vi.fn(),
  twilioFactory: vi.fn(),
  dnsLookup: vi.fn(),
}));

vi.mock('../src/config', async () => {
  const actual = (await vi.importActual('../src/config')) as any;
  return {
    ...actual,
    CONFIG: {
      ...actual.CONFIG,
      resendApiKey: 're_test_secret_resend_api_key_12345',
      resendFromEmail: 'no-reply@example.com',
      twilioAccountSid: 'AC_twilio_secret_12345',
      twilioAuthToken: 'secret_twilio_auth_token_67890',
      twilioFromNumber: '+15551234567',
      maxWebhookRetry: 3,
      webhookBackoffBaseMs: 10,
      dueWarningHours: 48,
    },
  };
});

vi.mock('node:dns/promises', () => ({
  lookup: dnsLookup,
}));

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: emailSend } };
  }),
}));

vi.mock('twilio', () => ({ default: twilioFactory }));

function makeInvoice(id: number) {
  return {
    id,
    freelancer: 'GFREELANCER',
    payer: 'GPAYER',
    amount: '100000000',
    due_date: Math.floor(Date.now() / 1000) + 86400,
    discount_rate: 300,
    status: 'Funded' as const,
    funder: 'GFUNDER',
    funded_at: 1_700_000_000,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

function makePayload(trigger: any, invoiceId: number, recipient: string, eventId?: string) {
  return {
    trigger,
    invoice: makeInvoice(invoiceId),
    recipientAddress: recipient,
    subject: `Invoice #${invoiceId} ${trigger}`,
    message: `Audit payload ${trigger}`,
    actor: 'freelancer' as const,
    eventId: eventId ?? `evt-audit-${invoiceId}-${trigger}`,
  };
}

beforeEach(() => {
  setDb(createDb(':memory:'));
  resetProviderHealth();
  clearDeadLetterQueue();
  resetCircuitBreakers();
  resetFallbackDedupe();
  fallbackCapacityLimiter.reset();
  vi.useFakeTimers();
  emailSend.mockReset().mockResolvedValue({ id: 'email-1' });
  smsCreate.mockReset().mockResolvedValue({ sid: 'SM123' });
  twilioFactory.mockReturnValue({ messages: { create: smsCreate } });
  dnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Fallback Provider Audit: Credential Isolation & Duplicate Sends (#1470)', () => {
  describe('Credential Isolation across providers', () => {
    it('isolates credentials so webhook requests never leak email or SMS secrets', async () => {
      const recipient = 'GRECIPIENT_CREDS_ISOLATION';
      const emailSub = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'creds@example.com',
        triggers: ['invoice_funded'],
      });
      createSubscription({
        stellar_address: recipient,
        channel: 'webhook',
        destination: 'https://webhook-audit.example.com/endpoint',
        triggers: ['invoice_funded'],
        webhook_secret: 'whsec_custom_endpoint_secret',
      });

      // Primary email provider fails, triggering fallback to webhook
      simulateProviderOutage('email');

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      const promise = deliverWithFallback(
        emailSub as any,
        makePayload('invoice_funded', 201, recipient) as any
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.fallbackChannel).toBe('webhook');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Verify outbound webhook call inspects headers: neither Resend API key nor Twilio token is present
      const callArgs = fetchMock.mock.calls[0];
      const headers = callArgs[1]?.headers ?? {};

      expect(headers['X-ILN-Trigger']).toBe('invoice_funded');
      expect(headers['X-ILN-Recipient']).toBe(recipient);
      expect(headers['X-ILN-Signature']).toContain('sha256=');

      // Crucial credential isolation verification:
      expect(JSON.stringify(headers)).not.toContain('re_test_secret_resend_api_key_12345');
      expect(JSON.stringify(headers)).not.toContain('AC_twilio_secret_12345');
      expect(JSON.stringify(headers)).not.toContain('secret_twilio_auth_token_67890');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('assertCredentialIsolation validates clean headers and detects leaks', () => {
      const safeHeaders = {
        'Content-Type': 'application/json',
        'X-ILN-Trigger': 'invoice_funded',
        'X-ILN-Signature': 'sha256=abcdef12345',
      };
      expect(() => assertCredentialIsolation('webhook', safeHeaders)).not.toThrow();

      const leakedHeaders = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer re_test_secret_resend_api_key_12345',
      };
      expect(() => assertCredentialIsolation('webhook', leakedHeaders)).toThrow(
        /cross-provider credential leak/i
      );
    });
  });

  describe('Duplicate Provider Sends Prevention', () => {
    it('does not send to fallback provider when primary provider delivery succeeds', async () => {
      const recipient = 'GRECIPIENT_NO_DUPLICATE';
      const emailSub = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'single@example.com',
        triggers: ['invoice_funded'],
      });
      createSubscription({
        stellar_address: recipient,
        channel: 'webhook',
        destination: 'https://no-duplicate.example.com/webhook',
        triggers: ['invoice_funded'],
      });

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      const promise = deliverWithFallback(
        emailSub as any,
        makePayload('invoice_funded', 202, recipient) as any
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.channel).toBe('email');
      expect(result.fallbackChannel).toBeUndefined();

      // Primary email was sent once
      expect(emailSend).toHaveBeenCalledTimes(1);
      // Fallback webhook was NOT sent
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('suppresses duplicate provider sends when the same event is replayed', async () => {
      const recipient = 'GRECIPIENT_REPLAY_DEDUP';
      const emailSub = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'replay@example.com',
        triggers: ['invoice_paid'],
      });

      const payload = makePayload('invoice_paid', 203, recipient, 'evt-fixed-dedup-1');

      // First dispatch succeeds
      const firstPromise = deliverWithFallback(emailSub as any, payload as any);
      await vi.runAllTimersAsync();
      const firstResult = await firstPromise;
      expect(firstResult.success).toBe(true);
      expect(firstResult.attempted).toBe(true);
      expect(emailSend).toHaveBeenCalledTimes(1);

      // Second dispatch of identical event is deduplicated
      const secondPromise = deliverWithFallback(emailSub as any, payload as any);
      await vi.runAllTimersAsync();
      const secondResult = await secondPromise;

      expect(secondResult.success).toBe(true);
      expect(secondResult.attempted).toBe(false);
      expect(secondResult.deduplicated).toBe(true);
      expect(secondResult.error).toMatch(/deduplication/i);

      // Email provider was NOT called a second time
      expect(emailSend).toHaveBeenCalledTimes(1);
    });

    it('buildDeliveryDedupeKey and dedupe helpers accurately track dispatched deliveries', () => {
      const key = buildDeliveryDedupeKey('GRECIPIENT', 'invoice_paid', 999, 'evt-1');
      expect(key).toBe('GRECIPIENT:invoice_paid:999:evt-1');

      expect(isDeliveryDuplicate('GRECIPIENT', 'invoice_paid', 999, 'evt-1')).toBe(false);
      markDeliverySent('GRECIPIENT', 'invoice_paid', 999, 'evt-1');
      expect(isDeliveryDuplicate('GRECIPIENT', 'invoice_paid', 999, 'evt-1')).toBe(true);

      resetFallbackDedupe();
      expect(isDeliveryDuplicate('GRECIPIENT', 'invoice_paid', 999, 'evt-1')).toBe(false);
    });
  });

  describe('Audit cases: normal, failed, repeated, stale, and interrupted', () => {
    it('normal: routes directly to primary without engaging fallback when healthy', async () => {
      const recipient = 'GRECIPIENT_NORMAL';
      const emailSub = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'normal@example.com',
        triggers: ['invoice_submitted'],
      });

      const promise = deliverWithFallback(
        emailSub as any,
        makePayload('invoice_submitted', 204, recipient) as any
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.channel).toBe('email');
      expect(getProviderHealth('email')).toBe('healthy');
    });

    it('failed: properly records primary failure and engages fallback', async () => {
      const recipient = 'GRECIPIENT_FAILED_PRIMARY';
      const emailSub = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'fail@example.com',
        triggers: ['invoice_funded'],
      });
      createSubscription({
        stellar_address: recipient,
        channel: 'sms',
        destination: '+15554443333',
        triggers: ['invoice_funded'],
      });

      // Primary email fails
      emailSend.mockRejectedValue(new Error('Resend 500 internal error'));
      smsCreate.mockResolvedValueOnce({ sid: 'SM_FALLBACK_OK' });

      const promise = deliverWithFallback(
        emailSub as any,
        makePayload('invoice_funded', 205, recipient) as any
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.fallbackChannel).toBe('sms');
      expect(smsCreate).toHaveBeenCalledTimes(1);
    });

    it('stale: skips disabled or unsubscribed channels during fallback evaluation', async () => {
      const recipient = 'GRECIPIENT_STALE_SUB';
      const emailSub = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'stale@example.com',
        triggers: ['invoice_funded'],
      });
      // Webhook subscription is for a DIFFERENT trigger, so it's not eligible
      createSubscription({
        stellar_address: recipient,
        channel: 'webhook',
        destination: 'https://other-trigger.example.com',
        triggers: ['invoice_paid'], // mismatch
      });

      simulateProviderOutage('email');

      const promise = deliverWithFallback(
        emailSub as any,
        makePayload('invoice_funded', 206, recipient) as any
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      // No matching fallback found
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/All fallback channels exhausted or no fallback subscription/i);
    });
  });
});

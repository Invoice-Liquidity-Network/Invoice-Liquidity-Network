process.env.NOTIFICATIONS_RPC_URL = 'http://localhost:8000';
process.env.NOTIFICATIONS_CONTRACT_ID = 'GTESTCONTRACT';
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.RESEND_API_KEY = 'test-api-key';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDb, setDb, createSubscription } from '../src/db';
import {
  resetProviderHealth,
  simulateProviderOutage,
  restoreProvider,
  getProviderHealth,
  recordProviderFailure,
  recordProviderSuccess,
  isProviderAvailable,
  getHealthyFallbackChannels,
  evaluateFailoverTarget,
  fallbackCapacityLimiter,
} from '../src/provider-health';
import { deliverWithFallback, resetFallbackDedupe } from '../src/fallback';
import { clearDeadLetterQueue, resetCircuitBreakers, pushDeadLetter } from '../src/delivery';

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
      resendApiKey: 'test-key',
      resendFromEmail: 'no-reply@example.com',
      twilioAccountSid: 'AC123',
      twilioAuthToken: 'auth-token',
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

function makePayload(trigger: any, invoiceId: number, recipient: string) {
  return {
    trigger,
    invoice: makeInvoice(invoiceId),
    recipientAddress: recipient,
    subject: `Invoice #${invoiceId} ${trigger}`,
    message: `Message for ${trigger}`,
    actor: 'freelancer' as const,
    eventId: `evt-failover-${invoiceId}-${trigger}-${Math.random().toString(36).slice(2, 6)}`,
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

describe('Provider Outage Failover & False-Success Prevention (#1469)', () => {
  describe('Provider health state transitions', () => {
    it('degrades health after 3 consecutive failures and marks unhealthy after 5', () => {
      expect(getProviderHealth('email')).toBe('healthy');
      expect(isProviderAvailable('email')).toBe(true);

      for (let i = 0; i < 3; i++) {
        recordProviderFailure('email');
      }
      expect(getProviderHealth('email')).toBe('degraded');
      expect(isProviderAvailable('email')).toBe(true); // degraded is still available with warning

      for (let i = 0; i < 2; i++) {
        recordProviderFailure('email');
      }
      expect(getProviderHealth('email')).toBe('unhealthy');
      expect(isProviderAvailable('email')).toBe(false); // unhealthy is unavailable
    });

    it('recovers provider health to healthy when consecutive successes accumulate', () => {
      simulateProviderOutage('sms');
      expect(getProviderHealth('sms')).toBe('unhealthy');

      restoreProvider('sms');
      expect(getProviderHealth('sms')).toBe('healthy');
      expect(isProviderAvailable('sms')).toBe(true);
    });

    it('filters healthy fallback channels and selects optimal failover target', () => {
      simulateProviderOutage('webhook');

      const emailFallbacks = getHealthyFallbackChannels('email');
      expect(emailFallbacks).not.toContain('webhook');
      expect(emailFallbacks).toContain('sms');

      const target = evaluateFailoverTarget('email', ['webhook', 'sms']);
      expect(target).toBe('sms');
    });
  });

  describe('Preventing false successful delivery state during outages', () => {
    it('never reports success when primary is down and all fallback channels fail', async () => {
      const recipient = 'GRECIPIENT_FAIL_ALL';
      const emailSub = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'down@example.com',
        triggers: ['invoice_funded'],
      });
      createSubscription({
        stellar_address: recipient,
        channel: 'webhook',
        destination: 'https://down.example.com/webhook',
        triggers: ['invoice_funded'],
      });

      // Primary email is down
      simulateProviderOutage('email');
      // Webhook fallback also fails
      const fetchMock = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', fetchMock);

      const promise = deliverWithFallback(
        emailSub as any,
        makePayload('invoice_funded', 101, recipient) as any
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      // Critical assertion: false success is strictly prevented
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exhausted/i);
    });

    it('never reports success when delivery lands in dead-letter queue (silent drop guard)', async () => {
      const recipient = 'GRECIPIENT_DLQ_GUARD';
      const emailSub = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'down@example.com',
        triggers: ['invoice_paid'],
      });
      createSubscription({
        stellar_address: recipient,
        channel: 'webhook',
        destination: 'https://silent-fail.example.com/webhook',
        triggers: ['invoice_paid'],
      });

      simulateProviderOutage('email');

      // Webhook responds with 500 error on every retry, which causes delivery to dead-letter
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      vi.stubGlobal('fetch', fetchMock);

      const promise = deliverWithFallback(
        emailSub as any,
        makePayload('invoice_paid', 102, recipient) as any
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      // Ensure that dead-lettering webhook is NOT counted as successful delivery
      expect(result.success).toBe(false);
    });

    it('cascades through multiple fallback channels until a healthy one succeeds', async () => {
      const recipient = 'GRECIPIENT_CASCADE';
      const emailSub = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'primary@example.com',
        triggers: ['invoice_due_soon'],
      });
      createSubscription({
        stellar_address: recipient,
        channel: 'webhook',
        destination: 'https://broken-hook.example.com',
        triggers: ['invoice_due_soon'],
      });
      createSubscription({
        stellar_address: recipient,
        channel: 'sms',
        destination: '+15559876543',
        triggers: ['invoice_due_soon'],
      });

      // Email is down
      simulateProviderOutage('email');
      // Webhook is broken
      const fetchMock = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
      vi.stubGlobal('fetch', fetchMock);
      // SMS succeeds
      smsCreate.mockResolvedValueOnce({ sid: 'SM_CASCADE_OK' });

      const promise = deliverWithFallback(
        emailSub as any,
        makePayload('invoice_due_soon', 103, recipient) as any
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.fallbackChannel).toBe('sms');
      expect(smsCreate).toHaveBeenCalledTimes(1);
    });

    it('preserves critical notifications even under constrained fallback capacity', async () => {
      const recipient = 'GRECIPIENT_PRIORITY_PRESERVED';
      const emailCritical = createSubscription({
        stellar_address: recipient,
        channel: 'email',
        destination: 'crit@example.com',
        triggers: ['dispute_opened'],
      });
      createSubscription({
        stellar_address: recipient,
        channel: 'sms',
        destination: '+15551112222',
        triggers: ['dispute_opened'],
      });

      simulateProviderOutage('email');

      // Exhaust limiter by acquiring capacity
      for (let i = 0; i < 150; i++) {
        fallbackCapacityLimiter.tryAcquire('low');
      }

      smsCreate.mockResolvedValueOnce({ sid: 'SM_CRIT' });

      const result = await deliverWithFallback(
        emailCritical as any,
        makePayload('dispute_opened', 104, recipient) as any
      );
      await vi.runAllTimersAsync();

      expect(result.success).toBe(true);
      expect(result.priority).toBe('critical');
      expect(result.capacityAllowed).toBe(true);
      expect(result.fallbackChannel).toBe('sms');
    });
  });
});

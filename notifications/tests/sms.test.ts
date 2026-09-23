import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSms, deliverNotification } from '../src/delivery';

// Hoisted so the tests can assert on the send itself. src/delivery.ts memoises
// the client, so the factory is only invoked once for the whole file and
// `mock.results` is empty for every test after the first.
const { twilioCreate } = vi.hoisted(() => ({ twilioCreate: vi.fn() }));

vi.mock('twilio', () => ({
  default: vi.fn(function Twilio() {
    return { messages: { create: twilioCreate } };
  }),
}));

// `new Resend(...)` runs at import time of src/delivery.ts, so the mock has to
// be constructible — an arrow function is not.
vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: vi.fn().mockResolvedValue({}) } };
  }),
}));

// Mock paths are resolved relative to this file, so the module under test only
// picks this up as "../src/config", not "./config".
vi.mock('../src/config', () => ({
  CONFIG: {
    resendApiKey: 'test-key',
    resendFromEmail: 'test@example.com',
    twilioAccountSid: 'AC123',
    twilioAuthToken: 'auth-token',
    twilioFromNumber: '+15551234567',
    maxWebhookRetry: 3,
    webhookBackoffBaseMs: 500,
  },
}));

function makeSubscription(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    stellar_address: 'GTEST',
    channel: 'sms' as const,
    destination: '+15559876543',
    triggers: ['invoice_funded' as const],
    created_at: Date.now(),
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
      due_date: Math.floor(Date.now() / 1000) + 86400,
      discount_rate: 300,
      status: 'Funded' as const,
      funder: null,
      funded_at: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    recipientAddress: 'GTEST',
    subject: 'Invoice #42 funded',
    message: 'Your invoice has been funded',
    actor: 'freelancer' as const,
    ...overrides,
  };
}

beforeEach(() => {
  twilioCreate.mockResolvedValue({ sid: 'SM123', status: 'queued' });
});

describe('sendSms', () => {
  it('sends SMS via Twilio with correct parameters', async () => {
    const Twilio = (await import('twilio')).default;
    const mockTwilio = Twilio as unknown as ReturnType<typeof vi.fn>;

    const sub = makeSubscription();
    const payload = makePayload();

    await sendSms(sub, payload);

    // The client is built lazily on the first send, which is this test.
    expect(mockTwilio).toHaveBeenCalledWith('AC123', 'auth-token');
    expect(twilioCreate).toHaveBeenCalledWith({
      to: '+15559876543',
      from: '+15551234567',
      body: expect.stringContaining('Invoice #42'),
    });
  });

  it('throws when Twilio credentials are not configured', async () => {
    // src/delivery.ts memoises the Twilio client, so blanking the credentials on
    // the shared CONFIG would be ignored once another test has built one. Load a
    // fresh copy of the module against credential-less config instead.
    vi.resetModules();
    vi.doMock('../src/config', () => ({
      CONFIG: {
        resendApiKey: 'test-key',
        resendFromEmail: 'test@example.com',
        twilioAccountSid: '',
        twilioAuthToken: '',
        twilioFromNumber: '',
        maxWebhookRetry: 3,
        webhookBackoffBaseMs: 500,
      },
    }));

    const { sendSms: sendSmsWithoutCredentials } = await import('../src/delivery');

    await expect(sendSmsWithoutCredentials(makeSubscription(), makePayload())).rejects.toThrow(
      'Twilio credentials not configured'
    );

    vi.doUnmock('../src/config');
    vi.resetModules();
  });
});

describe('deliverNotification SMS channel', () => {
  it('routes SMS channel to sendSms', async () => {
    const sub = makeSubscription({ channel: 'sms' });
    const payload = makePayload();

    await deliverNotification(sub, payload);

    expect(twilioCreate).toHaveBeenCalledOnce();
  });
});

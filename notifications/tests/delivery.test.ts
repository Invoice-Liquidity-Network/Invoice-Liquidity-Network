import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NotificationService } from '../src/service';
import type {
  EmailClient,
  HttpClient,
  SubscriptionStore,
  ProcessedEventStore,
} from '../src/service';
import type { InvoiceEvent, Subscription } from '../src/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FREELANCER = 'GFREELANCER000000000000000000000000000000000000000000000001';
const PAYER = 'GPAYER00000000000000000000000000000000000000000000000000001';
const FUNDER = 'GFUNDER000000000000000000000000000000000000000000000000001';
const WEBHOOK_URL = 'https://example.com/iln-webhook';

function makeEvent(overrides: Partial<InvoiceEvent> = {}): InvoiceEvent {
  return {
    eventId: 'evt-delivery-001',
    type: 'paid',
    invoiceId: 99,
    freelancer: FREELANCER,
    payer: PAYER,
    funder: FUNDER,
    amount: '1000000000',
    dueDate: Math.floor(Date.now() / 1000) + 86400,
    discountRate: 300,
    ...overrides,
  };
}

function makeEmailSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-email',
    address: FREELANCER,
    role: 'freelancer',
    channel: 'email',
    email: 'freelancer@example.com',
    webhookStatus: 'active',
    active: true,
    ...overrides,
  };
}

function makeWebhookSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-webhook',
    address: FUNDER,
    role: 'lp',
    channel: 'webhook',
    webhookUrl: WEBHOOK_URL,
    webhookStatus: 'active',
    active: true,
    ...overrides,
  };
}

// ─── Minimal in-memory stores ─────────────────────────────────────────────────

function makeStores(subs: Subscription[]) {
  const processedIds = new Set<string>();
  const updatedSubs = new Map<string, Partial<Subscription>>();

  const subscriptionStore: SubscriptionStore = {
    getByAddress: vi
      .fn()
      .mockImplementation(async (addr: string) => subs.filter((s) => s.address === addr)),
    updateSubscription: vi
      .fn()
      .mockImplementation(async (id: string, updates: Partial<Subscription>) => {
        updatedSubs.set(id, updates);
      }),
  };

  const processedEventStore: ProcessedEventStore = {
    hasProcessed: vi.fn().mockImplementation(async (id: string) => processedIds.has(id)),
    markProcessed: vi.fn().mockImplementation(async (id: string) => {
      processedIds.add(id);
    }),
  };

  return { subscriptionStore, processedEventStore, updatedSubs };
}

// ─── MSW server for webhook HTTP mocking ──────────────────────────────────────

const server = setupServer();

beforeEach(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Email delivery', () => {
  // TC-03: Email delivery: mock Resend, verify correct template and recipient

  it('TC-03: sends email to the correct recipient with the correct template', async () => {
    const emailSend = vi.fn().mockResolvedValue(undefined);
    const emailClient: EmailClient = { send: emailSend };

    const sub = makeEmailSub({ email: 'freelancer@example.com' });
    const { subscriptionStore, processedEventStore } = makeStores([sub]);

    const http_client: HttpClient = { post: vi.fn() };
    const service = new NotificationService(
      emailClient,
      http_client,
      subscriptionStore,
      processedEventStore
    );

    await service.handleEvent(makeEvent({ type: 'paid' }));

    expect(emailSend).toHaveBeenCalledOnce();
    const [recipient, subject, body] = emailSend.mock.calls[0] as [string, string, string];

    expect(recipient).toBe('freelancer@example.com');
    expect(subject).toMatch(/settled/i);
    expect(body).toContain('Invoice #99');
    expect(body).toContain(FREELANCER);
  });
});

describe('Webhook delivery', () => {
  // TC-04: Webhook delivery: mock HTTP server, verify correct payload

  it('TC-04: sends webhook with correct payload to the subscription URL', async () => {
    let captured: unknown = null;

    server.use(
      http.post(WEBHOOK_URL, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ok: true });
      })
    );

    const sub = makeWebhookSub();
    const { subscriptionStore, processedEventStore } = makeStores([sub]);

    const realHttpClient: HttpClient = {
      post: async (url, payload) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return { status: res.status };
      },
    };

    const service = new NotificationService(
      { send: vi.fn() },
      realHttpClient,
      subscriptionStore,
      processedEventStore
    );

    const event = makeEvent({ type: 'paid', funder: FUNDER });
    const results = await service.handleEvent(event);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].channel).toBe('webhook');

    expect(captured).toMatchObject({
      eventId: 'evt-delivery-001',
      type: 'paid',
      invoiceId: 99,
      role: 'lp',
    });
  });

  // TC-05: Webhook retry: first two attempts fail (mock 500), third succeeds

  it('TC-05: retries webhook on 500 errors and succeeds on the third attempt', async () => {
    let callCount = 0;

    server.use(
      http.post(WEBHOOK_URL, () => {
        callCount += 1;
        if (callCount < 3) {
          return HttpResponse.json({ error: 'server error' }, { status: 500 });
        }
        return HttpResponse.json({ ok: true });
      })
    );

    const sub = makeWebhookSub({ eventId: 'evt-retry' } as Partial<Subscription>);
    const { subscriptionStore, processedEventStore } = makeStores([sub]);

    const realHttpClient: HttpClient = {
      post: async (url, payload) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return { status: res.status };
      },
    };

    const service = new NotificationService(
      { send: vi.fn() },
      realHttpClient,
      subscriptionStore,
      processedEventStore
    );

    const event = makeEvent({ eventId: 'evt-retry-001', type: 'paid', funder: FUNDER });
    const results = await service.handleEvent(event);

    expect(callCount).toBe(3);
    expect(results[0].success).toBe(true);
  });

  // TC-06: Webhook retry exhausted — after 3 failures, subscription marked as failed

  it('TC-06: marks subscription as failed after all retries are exhausted', async () => {
    server.use(
      http.post(WEBHOOK_URL, () => HttpResponse.json({ error: 'server error' }, { status: 500 }))
    );

    const sub = makeWebhookSub({ id: 'sub-failing' });
    const { subscriptionStore, processedEventStore, updatedSubs } = makeStores([sub]);

    const realHttpClient: HttpClient = {
      post: async (url, payload) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return { status: res.status };
      },
    };

    const service = new NotificationService(
      { send: vi.fn() },
      realHttpClient,
      subscriptionStore,
      processedEventStore
    );

    const event = makeEvent({ eventId: 'evt-exhaust-001', type: 'paid', funder: FUNDER });
    const results = await service.handleEvent(event);

    expect(results[0].success).toBe(false);
    expect(updatedSubs.get('sub-failing')).toMatchObject({ webhookStatus: 'failed' });
  });
});

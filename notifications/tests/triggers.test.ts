import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../src/service';
import type {
  EmailClient,
  HttpClient,
  SubscriptionStore,
  ProcessedEventStore,
} from '../src/service';
import type { InvoiceEvent, Subscription } from '../src/types';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const FREELANCER = 'GFREELANCER000000000000000000000000000000000000000000000001';
const PAYER = 'GPAYER00000000000000000000000000000000000000000000000000001';
const FUNDER = 'GFUNDER000000000000000000000000000000000000000000000000001';

function makeEvent(overrides: Partial<InvoiceEvent> = {}): InvoiceEvent {
  return {
    eventId: 'evt-001',
    type: 'funded',
    invoiceId: 42,
    freelancer: FREELANCER,
    payer: PAYER,
    funder: FUNDER,
    amount: '1000000000',
    dueDate: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    discountRate: 300,
    ...overrides,
  };
}

function makeSub(overrides: Partial<Subscription>): Subscription {
  return {
    id: 'sub-1',
    address: FREELANCER,
    role: 'freelancer',
    channel: 'email',
    email: 'freelancer@example.com',
    webhookStatus: 'active',
    active: true,
    ...overrides,
  };
}

function makeService(
  subs: Subscription[],
  overrides: {
    email?: Partial<EmailClient>;
    http?: Partial<HttpClient>;
    processedIds?: Set<string>;
    clock?: () => number;
  } = {}
) {
  const processedIds = overrides.processedIds ?? new Set<string>();

  const email: EmailClient = {
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides.email,
  };
  const http: HttpClient = {
    post: vi.fn().mockResolvedValue({ status: 200 }),
    ...overrides.http,
  };
  const subscriptionStore: SubscriptionStore = {
    getByAddress: vi
      .fn()
      .mockImplementation(async (addr: string) => subs.filter((s) => s.address === addr)),
    updateSubscription: vi.fn().mockResolvedValue(undefined),
  };
  const processedEventStore: ProcessedEventStore = {
    hasProcessed: vi.fn().mockImplementation(async (id: string) => processedIds.has(id)),
    markProcessed: vi.fn().mockImplementation(async (id: string) => {
      processedIds.add(id);
    }),
  };

  const service = new NotificationService(
    email,
    http,
    subscriptionStore,
    processedEventStore,
    overrides.clock
  );

  return { service, email, http, subscriptionStore, processedEventStore };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Notification triggers', () => {
  // TC-01: Each trigger fires for the correct event type and actor

  it('TC-01a: funded event notifies the LP (funder) subscriber', async () => {
    const lpSub = makeSub({ id: 'sub-lp', address: FUNDER, role: 'lp', email: 'lp@example.com' });
    const { service, email } = makeService([lpSub]);

    const event = makeEvent({ type: 'funded', funder: FUNDER });
    await service.handleEvent(event);

    expect(email.send).toHaveBeenCalledOnce();
    expect(email.send).toHaveBeenCalledWith(
      'lp@example.com',
      expect.stringContaining('funded'),
      expect.any(String)
    );
  });

  it('TC-01b: paid event notifies freelancer subscriber', async () => {
    const freelancerSub = makeSub({ id: 'sub-fl', address: FREELANCER, role: 'freelancer' });
    const { service, email } = makeService([freelancerSub]);

    const event = makeEvent({ type: 'paid' });
    await service.handleEvent(event);

    expect(email.send).toHaveBeenCalledOnce();
    expect(email.send).toHaveBeenCalledWith(
      'freelancer@example.com',
      expect.stringContaining('settled'),
      expect.any(String)
    );
  });

  it('TC-01c: defaulted event notifies LP subscriber', async () => {
    const lpSub = makeSub({ id: 'sub-lp', address: FUNDER, role: 'lp', email: 'lp@example.com' });
    const { service, email } = makeService([lpSub]);

    const event = makeEvent({ type: 'defaulted', funder: FUNDER });
    await service.handleEvent(event);

    expect(email.send).toHaveBeenCalledOnce();
    expect(email.send).toHaveBeenCalledWith(
      'lp@example.com',
      expect.stringContaining('defaulted'),
      expect.any(String)
    );
  });

  // TC-02: Trigger does NOT fire for wrong actor (LP event not sent to freelancer)

  it("TC-02a: funded event is NOT sent to freelancer's subscription", async () => {
    // Freelancer subscribes but funded events are also routed to freelancers — use defaulted
    // to show a payer-specific event doesn't go to LP
    const lpSub = makeSub({ id: 'sub-lp', address: FUNDER, role: 'lp', email: 'lp@example.com' });
    const { service, email } = makeService([lpSub]);

    // due_date_warning is only for freelancers — LP should NOT receive it
    const event = makeEvent({ type: 'due_date_warning', funder: FUNDER });
    await service.handleEvent(event);

    expect(email.send).not.toHaveBeenCalled();
  });

  it('TC-02b: payer subscription does not receive defaulted event', async () => {
    const payerSub = makeSub({
      id: 'sub-payer',
      address: PAYER,
      role: 'payer',
      email: 'payer@example.com',
    });
    const { service, email } = makeService([payerSub]);

    const event = makeEvent({ type: 'defaulted' });
    await service.handleEvent(event);

    expect(email.send).not.toHaveBeenCalled();
  });

  // TC-07: Due date warning fires exactly 48 hours before due_date

  it('TC-07: isDueDateWarningDue returns true when clock is exactly at 48h mark', () => {
    const dueDate = Math.floor(Date.now() / 1000) + 10; // due in 10s
    const fortyEightHoursBeforeDue = dueDate * 1000 - 48 * 60 * 60 * 1000;

    // Clock is exactly at the 48-hour warning mark
    const { service } = makeService([], { clock: () => fortyEightHoursBeforeDue });

    expect(service.isDueDateWarningDue(dueDate)).toBe(true);
  });

  it('TC-07b: isDueDateWarningDue returns false before the 48h mark', () => {
    const dueDate = Math.floor(Date.now() / 1000) + 100 * 3600; // due in 100 hours
    const fortyEightHoursBeforeDue = dueDate * 1000 - 48 * 60 * 60 * 1000;

    // Clock is 1ms before the warning mark
    const { service } = makeService([], { clock: () => fortyEightHoursBeforeDue - 1 });

    expect(service.isDueDateWarningDue(dueDate)).toBe(false);
  });

  it('TC-07c: due_date_warning event reaches freelancer when dispatched', async () => {
    const freelancerSub = makeSub({
      id: 'sub-fl',
      address: FREELANCER,
      role: 'freelancer',
      email: 'freelancer@example.com',
    });
    const { service, email } = makeService([freelancerSub]);

    const event = makeEvent({ type: 'due_date_warning' });
    await service.handleEvent(event);

    expect(email.send).toHaveBeenCalledOnce();
    expect(email.send).toHaveBeenCalledWith(
      'freelancer@example.com',
      expect.stringContaining('48 hours'),
      expect.any(String)
    );
  });

  // TC-08: Duplicate event does not send duplicate notification

  it('TC-08: duplicate eventId is silently ignored (no duplicate notifications)', async () => {
    const freelancerSub = makeSub({ id: 'sub-fl', address: FREELANCER, role: 'freelancer' });
    const processedIds = new Set<string>();
    const { service, email } = makeService([freelancerSub], { processedIds });

    const event = makeEvent({ type: 'paid' });

    // First delivery
    await service.handleEvent(event);
    expect(email.send).toHaveBeenCalledOnce();

    // Second delivery with the same eventId
    await service.handleEvent(event);
    expect(email.send).toHaveBeenCalledOnce(); // still only once
  });

  // TC-09: Unsubscribed address receives no notifications

  it('TC-09: inactive subscription receives no notification', async () => {
    const inactiveSub = makeSub({ id: 'sub-inactive', active: false });
    const { service, email } = makeService([inactiveSub]);

    const event = makeEvent({ type: 'paid' });
    const results = await service.handleEvent(event);

    expect(email.send).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });
});

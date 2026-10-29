process.env.NOTIFICATIONS_RPC_URL = 'http://localhost:8000';
process.env.NOTIFICATIONS_CONTRACT_ID = 'GTESTCONTRACT';
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.RESEND_API_KEY = 'test-api-key';

/**
 * Issues #1277–#1280: delivery outcome tracking and recipient hardening.
 *
 * Like `processor.test.ts`, `src/db` is never mocked: every guarantee here is
 * asserted against the rows SQLite actually holds. Only the provider boundary
 * is replaced — `deliverNotification`, the fallback chain, and provider health
 * — via module factories, so the suite exercises the real processor, journal,
 * digest scheduler, recipient validation, and crypto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { deliverNotification, deliverWithFallback } = vi.hoisted(() => ({
  deliverNotification: vi.fn(),
  deliverWithFallback: vi.fn(),
}));

vi.mock('../delivery', () => ({ deliverNotification, getCircuitBreakerState: () => 'closed' }));
vi.mock('../fallback', () => ({ deliverWithFallback }));
vi.mock('../provider-health', () => ({ getProviderHealth: () => 'healthy' }));
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { nativeToScVal } from '@stellar/stellar-sdk';
import {
  createDb,
  setDb,
  createSubscription,
  upsertInvoice,
  enqueueDispatchAttempt,
  getPendingDispatchAttempts,
  getDispatchAttemptById,
  getDispatchOutcomeSummary,
  listDispatchAttempts,
  markDispatchAttemptDelivered,
  recordDispatchAttemptFailure,
  requeueFailedDispatchAttempt,
  hasSentNotification,
  logSentNotification,
  eraseNotificationDataForAddress,
  deleteSubscriptionById,
  verifyComplianceAuditChain,
} from '../db';
import * as rpc from '../rpc';
import { CONFIG } from '../config';
import { digestScheduler, DigestScheduler } from '../digest';
import { preferencesService } from '../preferences';
import { notificationsMetrics } from '../metrics';
import {
  processEvent,
  processScheduledNotifications,
  flushPendingNotifications,
} from '../processor';
import {
  InvalidRecipientError,
  maskRecipient,
  resolveEmailRecipient,
  validateEmailRecipient,
} from '../recipient';
import {
  assertRecipientKeyConfigured,
  decryptRecipientData,
  encryptRecipientData,
  recipientLookupForms,
  tokenizeRecipient,
} from '../recipient-crypto';
import type { Invoice, NotificationPayload } from '../types';

const WALLET = 'GAFREELANCERWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const KEY_A = 'a'.repeat(64);
const KEY_B = Buffer.alloc(32, 7).toString('base64');

let db: InstanceType<typeof Database>;
const savedEnv = { ...process.env };

beforeEach(() => {
  db = createDb(':memory:');
  setDb(db);
  vi.restoreAllMocks();
  deliverNotification.mockReset().mockResolvedValue(undefined);
  deliverWithFallback.mockReset().mockResolvedValue({
    attempted: false,
    success: false,
    priority: 'high',
    capacityAllowed: true,
    error: 'no fallback subscription',
  });
  notificationsMetrics.registry.resetMetrics();
});

afterEach(() => {
  process.env = { ...savedEnv };
  preferencesService.delete(WALLET);
  preferencesService.delete('GAFREELANCER');
  digestScheduler.unregister(WALLET);
  digestScheduler.unregister('GAFREELANCER');
});

// ─── #1277: delivery attempts and terminal outcomes ─────────────────────────

describe('#1277 dispatch attempts reach a terminal outcome', () => {
  it('baseline gap: a permanently failing destination no longer retries forever', async () => {
    const invoice = sampleInvoice(100);
    const subscription = emailSubscription(invoice.freelancer, 'bounce@example.com');
    const attempt = enqueueDispatchAttempt(subscription, samplePayload(invoice));
    const providerCalls = stubProviderFailure('provider 503');

    // Before #1277 this loop never terminated: the row stayed `pending` with an
    // ever-growing `attempts`. Now the budget is enforced.
    for (let poll = 0; poll < CONFIG.maxDispatchAttempts + 5; poll += 1) {
      await flushPendingNotifications();
    }

    expect(providerCalls()).toBe(CONFIG.maxDispatchAttempts);
    const row = rawAttempt(attempt.id);
    expect(row).toMatchObject({
      status: 'failed',
      outcome_reason: 'max_attempts_exhausted',
      attempts: CONFIG.maxDispatchAttempts,
    });
    expect(row.failed_at).toEqual(expect.any(Number));
    expect(row.last_error).toContain('provider 503');
    expect(getPendingDispatchAttempts()).toHaveLength(0);

    const terminal = await notificationsMetrics.dispatchTerminalTotal.get();
    expect(terminal.values).toContainEqual(
      expect.objectContaining({
        labels: { channel: 'email', outcome: 'max_attempts_exhausted' },
        value: 1,
      })
    );
    const attempts = await notificationsMetrics.dispatchAttemptsTotal.get();
    expect(attempts.values).toContainEqual(
      expect.objectContaining({
        labels: { channel: 'email', result: 'retry' },
        value: CONFIG.maxDispatchAttempts - 1,
      })
    );
  });

  it('records the boundary exactly: attempt N-1 retries, attempt N is terminal', () => {
    const invoice = sampleInvoice(101);
    const attempt = enqueueDispatchAttempt(
      emailSubscription(invoice.freelancer, 'edge@example.com'),
      samplePayload(invoice)
    );

    expect(recordDispatchAttemptFailure(attempt.id, 'e1', { maxAttempts: 2 })).toMatchObject({
      status: 'pending',
      attempts: 1,
      terminal: false,
      outcome_reason: null,
    });
    expect(recordDispatchAttemptFailure(attempt.id, 'e2', { maxAttempts: 2 })).toMatchObject({
      status: 'failed',
      attempts: 2,
      terminal: true,
      outcome_reason: 'max_attempts_exhausted',
    });
    // A third report finds no pending row and changes nothing.
    expect(recordDispatchAttemptFailure(attempt.id, 'e3', { maxAttempts: 2 })).toBeUndefined();
    expect(rawAttempt(attempt.id)).toMatchObject({ attempts: 2, last_error: 'e2' });
  });

  it('ends the row immediately on a non-retryable provider error', async () => {
    const invoice = sampleInvoice(102);
    vi.spyOn(rpc, 'fetchInvoice').mockResolvedValue(invoice as any);
    emailSubscription(invoice.freelancer, 'perm@example.com');
    stubNoFallback();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const permanent = Object.assign(new Error('mailbox does not exist'), { retryable: false });
    const deliverySpy = deliverNotification.mockRejectedValue(permanent);

    await processEvent(fundedEvent('evt-perm', invoice.id));
    await flushPendingNotifications();

    expect(deliverySpy).toHaveBeenCalledTimes(1);
    const [row] = rawAttempts();
    expect(row).toMatchObject({ status: 'failed', outcome_reason: 'permanent_error', attempts: 1 });
  });

  it('never lets a late failure report revive a delivered row', () => {
    const invoice = sampleInvoice(103);
    const attempt = enqueueDispatchAttempt(
      emailSubscription(invoice.freelancer, 'race@example.com'),
      samplePayload(invoice)
    );
    expect(markDispatchAttemptDelivered(attempt.id)).toBe(true);

    expect(recordDispatchAttemptFailure(attempt.id, 'stale failure')).toBeUndefined();
    expect(rawAttempt(attempt.id)).toMatchObject({
      status: 'delivered',
      outcome_reason: 'delivered',
      last_error: null,
    });
    expect(getPendingDispatchAttempts()).toHaveLength(0);
  });

  it('keeps a dead-lettered row terminal across restart and replay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iln-1277-'));
    const file = join(dir, 'notifications.sqlite');
    try {
      setDb(createDb(file));
      const now = Math.floor(Date.now() / 1000);
      upsertInvoice({ ...sampleInvoice(104), due_date: now - 3600 });
      createSubscription({
        stellar_address: 'GAPAYER',
        channel: 'webhook',
        destination: 'https://example.com/dead',
        triggers: ['invoice_overdue'],
        ownership_verified_at: Date.now(),
      });
      stubNoFallback();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const calls = stubProviderFailure('connection refused');

      // Scheduled pass + flushes until the budget is gone.
      await processScheduledNotifications();
      // Bounded so an unbounded-retry regression fails here instead of hanging.
      for (let poll = 0; poll < CONFIG.maxDispatchAttempts + 5; poll += 1) {
        await flushPendingNotifications();
      }
      expect(calls()).toBe(CONFIG.maxDispatchAttempts);

      // Restart: brand-new connection against the same file.
      setDb(createDb(file));
      // The overdue trigger fires again on every poll; a dead-lettered row must
      // not be re-sent by it, nor by the flush.
      await processScheduledNotifications();
      await flushPendingNotifications();
      await processScheduledNotifications();

      expect(calls()).toBe(CONFIG.maxDispatchAttempts);
      const summary = getDispatchOutcomeSummary();
      expect(summary).toMatchObject({ pending: 0, delivered: 0, failed: 1 });
      expect(summary.failedByReason).toEqual({ max_attempts_exhausted: 1 });
    } finally {
      setDb(db);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets an operator re-queue a failed row, audited, and the next flush delivers it', async () => {
    const invoice = sampleInvoice(105);
    const attempt = enqueueDispatchAttempt(
      emailSubscription(invoice.freelancer, 'requeue@example.com'),
      samplePayload(invoice)
    );
    recordDispatchAttemptFailure(attempt.id, 'outage', { maxAttempts: 1 });
    expect(rawAttempt(attempt.id).status).toBe('failed');
    expect(listDispatchAttempts({ status: 'failed' }).map((row) => row.id)).toEqual([attempt.id]);

    expect(requeueFailedDispatchAttempt(attempt.id, 'ops-oncall')).toBe(true);
    expect(rawAttempt(attempt.id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      outcome_reason: null,
      failed_at: null,
      last_error: 'outage',
    });

    const deliverySpy = deliverNotification.mockResolvedValue();
    await flushPendingNotifications();
    expect(deliverySpy).toHaveBeenCalledTimes(1);
    expect(rawAttempt(attempt.id)).toMatchObject({
      status: 'delivered',
      outcome_reason: 'delivered',
    });

    // Delivered rows can never be re-queued, and the action is on the chain.
    expect(requeueFailedDispatchAttempt(attempt.id, 'ops-oncall')).toBe(false);
    const chain = db
      .prepare(
        "SELECT action, subject_id FROM compliance_audit_chain WHERE action = 'dispatch-requeued'"
      )
      .all();
    expect(chain).toEqual([{ action: 'dispatch-requeued', subject_id: attempt.id }]);
    expect(verifyComplianceAuditChain().valid).toBe(true);
  });

  it('dead-letters an unreadable row instead of retrying it forever', () => {
    const invoice = sampleInvoice(106);
    const attempt = enqueueDispatchAttempt(
      emailSubscription(invoice.freelancer, 'corrupt@example.com'),
      samplePayload(invoice)
    );
    db.prepare('UPDATE dispatch_attempts SET subscription = ? WHERE id = ?').run(
      'renc:v1:AAAA.BBBB.CCCC',
      attempt.id
    );

    expect(getPendingDispatchAttempts()).toHaveLength(0);
    expect(rawAttempt(attempt.id)).toMatchObject({
      status: 'failed',
      outcome_reason: 'unreadable',
    });
  });

  it('exports queue depth as metrics after each flush', async () => {
    const invoice = sampleInvoice(107);
    enqueueDispatchAttempt(
      emailSubscription(invoice.freelancer, 'q@example.com'),
      samplePayload(invoice)
    );
    stubProviderFailure('timeout');

    await flushPendingNotifications();

    const queue = await notificationsMetrics.dispatchQueue.get();
    const byStatus = Object.fromEntries(queue.values.map((v) => [v.labels.status, v.value]));
    expect(byStatus).toMatchObject({
      pending: 1,
      delivered: 0,
      failed: 0,
      max_pending_attempts: 1,
    });
  });

  it('upgrades a pre-#1277 journal in place and keeps legacy rows working', () => {
    const invoice = sampleInvoice(108);
    const subscription = {
      id: 1,
      stellar_address: invoice.freelancer,
      channel: 'email',
      destination: 'legacy@example.com',
      triggers: ['invoice_funded'],
    };
    const legacyKey = JSON.stringify([
      invoice.id,
      'invoice_funded',
      invoice.freelancer,
      'email',
      'legacy@example.com',
      '',
    ]);
    // Seed a file with the schema as it stood before #1277/#1280, then let
    // createDb() migrate it in place.
    const dir = mkdtempSync(join(tmpdir(), 'iln-1277-mig-'));
    try {
      const file = join(dir, 'legacy.sqlite');
      const seed = new Database(file);
      seed.exec(`
        CREATE TABLE dispatch_attempts (
          id TEXT PRIMARY KEY, dedup_key TEXT NOT NULL, invoice_id INTEGER NOT NULL,
          trigger TEXT NOT NULL, recipient_address TEXT NOT NULL, channel TEXT NOT NULL,
          destination TEXT NOT NULL, event_id TEXT NOT NULL DEFAULT '',
          subscription TEXT NOT NULL, payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
          attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL DEFAULT 0, delivered_at INTEGER
        );
      `);
      seed
        .prepare(
          `INSERT INTO dispatch_attempts (id, dedup_key, invoice_id, trigger, recipient_address, channel,
             destination, event_id, subscription, payload, status, attempts, created_at)
           VALUES ('legacy-row', ?, ?, 'invoice_funded', ?, 'email', 'legacy@example.com', '', ?, ?, 'pending', 3, ?)`
        )
        .run(
          legacyKey,
          invoice.id,
          invoice.freelancer,
          JSON.stringify(subscription),
          JSON.stringify(samplePayload(invoice)),
          Date.now()
        );
      seed.close();

      setDb(createDb(file));
      const [pending] = getPendingDispatchAttempts();
      expect(pending).toMatchObject({ id: 'legacy-row', attempts: 3, outcome_reason: null });
      expect(pending.subscription).toMatchObject({ destination: 'legacy@example.com' });

      // Re-enqueueing the same notification collapses onto the legacy row
      // rather than queueing a tokenized duplicate beside it.
      const replay = enqueueDispatchAttempt(subscription as any, samplePayload(invoice));
      expect(replay).toMatchObject({ id: 'legacy-row', deduplicated: true });
      expect(getPendingDispatchAttempts()).toHaveLength(1);
    } finally {
      setDb(db);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── #1278: wallet identity vs notification address ─────────────────────────

describe('#1278 wallet identity is never used as a notification address', () => {
  it('baseline gap: digests register the subscribed mailbox, not the wallet address', async () => {
    const invoice = { ...sampleInvoice(200), freelancer: WALLET };
    vi.spyOn(rpc, 'fetchInvoice').mockResolvedValue(invoice as any);
    preferencesService.upsert(WALLET, { frequency: 'daily' });
    emailSubscription(WALLET, 'owner@example.com');
    const register = vi.spyOn(digestScheduler, 'register');
    const deliverySpy = deliverNotification.mockResolvedValue();

    await processEvent(fundedEvent('evt-digest', invoice.id));

    expect(register).toHaveBeenCalledTimes(1);
    const config = register.mock.calls[0][0];
    expect(config.stellarAddress).toBe(WALLET);
    expect(config.email).toBe('owner@example.com');
    expect(config.email).not.toBe(WALLET);
    expect(digestScheduler.pendingCount(WALLET)).toBe(1);
    expect(deliverySpy).not.toHaveBeenCalled();
  });

  it('skips and counts a digest recipient with no email subscription', async () => {
    const invoice = { ...sampleInvoice(201), freelancer: WALLET };
    vi.spyOn(rpc, 'fetchInvoice').mockResolvedValue(invoice as any);
    preferencesService.upsert(WALLET, { frequency: 'weekly' });
    createSubscription({
      stellar_address: WALLET,
      channel: 'webhook',
      destination: 'https://example.com/hook',
      triggers: ['invoice_funded'],
      ownership_verified_at: Date.now(),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const register = vi.spyOn(digestScheduler, 'register');

    await processEvent(fundedEvent('evt-no-email', invoice.id));

    expect(register).not.toHaveBeenCalled();
    expect(digestScheduler.registeredAddresses()).not.toContain(WALLET);
    await expectRejection('email', 'digest_enqueue', 'no_email_subscription');
  });

  it('rejects a subscription whose destination is the wallet address itself', () => {
    expect(
      resolveEmailRecipient(WALLET, 'invoice_funded', [
        { channel: 'email', destination: WALLET, triggers: ['invoice_funded'] },
      ])
    ).toEqual({ ok: false, reason: 'wallet_address' });
    expect(
      resolveEmailRecipient('GAPAYER', 'invoice_funded', [
        { channel: 'email', destination: 'GAPAYER', triggers: ['invoice_funded'] },
      ])
    ).toEqual({ ok: false, reason: 'wallet_address' });
  });

  it('resolves deterministically to the first valid mailbox for the trigger', () => {
    const subs = [
      { channel: 'email', destination: 'paid-only@example.com', triggers: ['invoice_paid'] },
      { channel: 'email', destination: 'not an email', triggers: ['invoice_funded'] },
      { channel: 'email', destination: 'first@example.com', triggers: ['invoice_funded'] },
      { channel: 'email', destination: 'second@example.com', triggers: ['invoice_funded'] },
    ];
    expect(resolveEmailRecipient(WALLET, 'invoice_funded', subs)).toEqual({
      ok: true,
      email: 'first@example.com',
    });
    expect(resolveEmailRecipient(WALLET, 'invoice_overdue', subs)).toEqual({
      ok: false,
      reason: 'no_email_subscription',
    });
  });
});

// ─── #1279: email validation before digest enqueue ──────────────────────────

describe('#1279 email recipients are validated before enqueue', () => {
  it.each([
    ['user@example.com'],
    ['first.last+tag@sub.example.co.uk'],
    ["o'brien@example.io"],
    ['user@xn--bcher-kva.example'],
  ])('accepts %s', (email) => {
    expect(validateEmailRecipient(email)).toEqual({ valid: true, email });
  });

  it.each([
    [undefined, 'missing'],
    ['', 'missing'],
    ['user@example.com\r\nBcc: victim@example.com', 'control_characters'],
    ['user @example.com', 'control_characters'],
    [WALLET, 'wallet_address'],
    ['a@b@example.com', 'malformed'],
    ['user@localhost', 'malformed'],
    ['user@-bad.example.com', 'malformed'],
    ['user@example.c', 'malformed'],
    ['.user@example.com', 'malformed'],
    ['user..dots@example.com', 'malformed'],
    [`${'l'.repeat(65)}@example.com`, 'too_long'],
    [
      `user@${'d'.repeat(63)}.${'d'.repeat(63)}.${'d'.repeat(63)}.${'d'.repeat(60)}.com`,
      'too_long',
    ],
  ])('rejects %j as %s', (email, reason) => {
    expect(validateEmailRecipient(email)).toEqual({ valid: false, reason });
  });

  it('accepts the 254-octet boundary and rejects 255', () => {
    const domain = `${'d'.repeat(63)}.${'d'.repeat(63)}.${'d'.repeat(63)}.com`; // 195
    const at254 = `${'l'.repeat(254 - domain.length - 1)}@${domain}`;
    expect(at254.length).toBe(254);
    expect(validateEmailRecipient(at254).valid).toBe(true);
    expect(validateEmailRecipient(`l${at254}`)).toEqual({ valid: false, reason: 'too_long' });
  });

  it('DigestScheduler.register refuses invalid mail and keeps the prior registration', async () => {
    const sent: string[] = [];
    const scheduler = new DigestScheduler({ send: async (to) => void sent.push(to) });
    scheduler.register({
      stellarAddress: WALLET,
      email: 'good@example.com',
      frequency: 'daily',
      unsubscribeToken: 't',
    });
    scheduler.buffer(WALLET, sampleEvent());

    expect(() =>
      scheduler.register({
        stellarAddress: WALLET,
        email: WALLET,
        frequency: 'daily',
        unsubscribeToken: 't',
      })
    ).toThrow(InvalidRecipientError);
    expect(() =>
      scheduler.register({
        stellarAddress: 'GNEW',
        email: 'x@y',
        frequency: 'daily',
        unsubscribeToken: 't',
      })
    ).toThrow(InvalidRecipientError);
    expect(scheduler.registeredAddresses()).toEqual([WALLET]);

    await scheduler.flush(WALLET);
    expect(sent).toEqual(['good@example.com']);
  });

  it('does not enqueue an immediate email to an invalid stored destination', async () => {
    const invoice = sampleInvoice(300);
    vi.spyOn(rpc, 'fetchInvoice').mockResolvedValue(invoice as any);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Bypass API validation, as a pre-validation row or direct DB write would.
    createSubscription({
      stellar_address: invoice.freelancer,
      channel: 'email',
      destination: 'victim@example.com\r\nBcc: attacker@example.com',
      triggers: ['invoice_funded'],
      ownership_verified_at: Date.now(),
    });
    const deliverySpy = deliverNotification.mockResolvedValue();

    await processEvent(fundedEvent('evt-invalid', invoice.id));

    expect(deliverySpy).not.toHaveBeenCalled();
    expect(rawAttempts()).toHaveLength(0);
    await expectRejection('email', 'dispatch_enqueue', 'control_characters');
  });

  it('closes out a legacy pending row with an invalid mailbox without a provider call', async () => {
    const invoice = sampleInvoice(301);
    const subscription = createSubscription({
      stellar_address: invoice.freelancer,
      channel: 'email',
      destination: invoice.freelancer, // the #1278 shape, journaled before the fix
      triggers: ['invoice_funded'],
      ownership_verified_at: Date.now(),
    });
    const attempt = enqueueDispatchAttempt(subscription, samplePayload(invoice));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deliverySpy = deliverNotification.mockResolvedValue();

    await flushPendingNotifications();

    expect(deliverySpy).not.toHaveBeenCalled();
    expect(rawAttempt(attempt.id)).toMatchObject({
      status: 'failed',
      outcome_reason: 'invalid_recipient',
    });
  });
});

// ─── #1280: recipient data at rest ──────────────────────────────────────────

describe('#1280 recipient data is tokenized or encrypted at rest', () => {
  it('baseline gap: no journal or ledger column holds the destination in the clear', async () => {
    const invoice = sampleInvoice(400);
    vi.spyOn(rpc, 'fetchInvoice').mockResolvedValue(invoice as any);
    emailSubscription(invoice.freelancer, 'secret.person@example.com');
    createSubscription({
      stellar_address: invoice.payer,
      channel: 'sms',
      destination: '+15551234567',
      triggers: ['invoice_funded'],
      ownership_verified_at: Date.now(),
    });
    const deliverySpy = deliverNotification.mockResolvedValue();

    await processEvent(fundedEvent('evt-at-rest', invoice.id));
    expect(deliverySpy).toHaveBeenCalledTimes(2);

    for (const table of ['dispatch_attempts', 'sent_notifications']) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
      expect(dump).not.toContain('secret.person');
      expect(dump).not.toContain('5551234567');
    }
    // ...but the retry path still gets the real destination back.
    const [first] = db
      .prepare('SELECT id FROM dispatch_attempts ORDER BY created_at, id')
      .all() as { id: string }[];
    const restored = getDispatchAttemptById(first.id)!;
    expect(['secret.person@example.com', '+15551234567']).toContain(
      restored.subscription.destination as string
    );
    // And dedup still recognises the delivered notifications.
    expect(
      hasSentNotification(
        invoice.id,
        'invoice_funded',
        invoice.freelancer,
        'email',
        'secret.person@example.com'
      )
    ).toBe(true);
  });

  it('round-trips with AES-GCM and rejects tampering or a foreign key', () => {
    process.env.NOTIFICATIONS_RECIPIENT_KEY = KEY_A;
    const sealed = encryptRecipientData('{"destination":"a@example.com"}');
    expect(sealed.startsWith('renc:v1:')).toBe(true);
    expect(sealed).not.toContain('example.com');
    expect(encryptRecipientData('same')).not.toBe(encryptRecipientData('same')); // random IV
    expect(decryptRecipientData(sealed)).toBe('{"destination":"a@example.com"}');

    const [iv, tag, ct] = sealed.slice('renc:v1:'.length).split('.');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 1;
    expect(() =>
      decryptRecipientData(`renc:v1:${iv}.${tag}.${flipped.toString('base64')}`)
    ).toThrow();

    process.env.NOTIFICATIONS_RECIPIENT_KEY = KEY_B;
    expect(() => decryptRecipientData(sealed)).toThrow(/Unable to decrypt/);
    // Legacy plaintext passes straight through.
    expect(decryptRecipientData('{"legacy":true}')).toBe('{"legacy":true}');
  });

  it('supports key rotation through NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS', () => {
    process.env.NOTIFICATIONS_RECIPIENT_KEY = KEY_A;
    const invoice = sampleInvoice(401);
    logSentNotification(
      invoice.id,
      'invoice_funded',
      invoice.freelancer,
      'email',
      'rotate@example.com'
    );
    const sealed = encryptRecipientData('payload');

    process.env.NOTIFICATIONS_RECIPIENT_KEY = KEY_B;
    process.env.NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS = KEY_A;
    expect(decryptRecipientData(sealed)).toBe('payload');
    expect(
      hasSentNotification(
        invoice.id,
        'invoice_funded',
        invoice.freelancer,
        'email',
        'rotate@example.com'
      )
    ).toBe(true);

    delete process.env.NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS;
    expect(
      hasSentNotification(
        invoice.id,
        'invoice_funded',
        invoice.freelancer,
        'email',
        'rotate@example.com'
      )
    ).toBe(false);
  });

  it('fails closed in production without a key, and on malformed key material', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NOTIFICATIONS_RECIPIENT_KEY;
    expect(() => assertRecipientKeyConfigured()).toThrow(/NOTIFICATIONS_RECIPIENT_KEY is required/);
    expect(() => tokenizeRecipient('a@example.com')).toThrow();

    process.env.NOTIFICATIONS_RECIPIENT_KEY = 'too-short';
    expect(() => assertRecipientKeyConfigured()).toThrow(/32 bytes/);

    process.env.NOTIFICATIONS_RECIPIENT_KEY = KEY_A;
    expect(() => assertRecipientKeyConfigured()).not.toThrow();
  });

  it('tokens are deterministic per key, idempotent, and key-dependent', () => {
    process.env.NOTIFICATIONS_RECIPIENT_KEY = KEY_A;
    const token = tokenizeRecipient('t@example.com');
    expect(token).toMatch(/^rtok:v1:[0-9a-f]{64}$/);
    expect(tokenizeRecipient('t@example.com')).toBe(token);
    expect(tokenizeRecipient(token)).toBe(token);
    expect(recipientLookupForms('t@example.com')).toEqual([token, 't@example.com']);
    process.env.NOTIFICATIONS_RECIPIENT_KEY = KEY_B;
    expect(tokenizeRecipient('t@example.com')).not.toBe(token);
  });

  it('erasure and unsubscribe still find tokenized and encrypted journal rows', () => {
    const invoice = sampleInvoice(402);
    const keep = emailSubscription('GAKEEP', 'keep@example.com');
    const drop = emailSubscription('GADROP', 'drop@example.com');
    const erase = emailSubscription(invoice.freelancer, 'erase@example.com');
    const keepAttempt = enqueueDispatchAttempt(keep, {
      ...samplePayload(invoice),
      recipientAddress: 'GAKEEP',
    });
    enqueueDispatchAttempt(drop, { ...samplePayload(invoice), recipientAddress: 'GADROP' });
    enqueueDispatchAttempt(erase, samplePayload(invoice));
    logSentNotification(
      invoice.id,
      'invoice_funded',
      invoice.freelancer,
      'email',
      'erase@example.com'
    );

    expect(deleteSubscriptionById(drop.id)).toBe(true);
    const result = eraseNotificationDataForAddress(invoice.freelancer, 'req-1280', 'ops');

    expect(result).toMatchObject({ subscriptions: 1, dispatchAttempts: 1, sentNotifications: 1 });
    expect(rawAttempts().map((row) => row.id)).toEqual([keepAttempt.id]);
  });

  it('masks destinations in operator-facing logs', () => {
    expect(maskRecipient('jane.doe@example.com')).toBe('ja***@ex***.com');
    expect(maskRecipient(WALLET)).toBe('GAFR…AAAA');
    expect(maskRecipient('https://hooks.example.com/secret/path?token=x')).toBe(
      'https://hooks.example.com/***'
    );
    expect(maskRecipient('+15551234567')).toBe('+15***67');
    expect(maskRecipient(undefined)).toBe('<none>');
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function sampleInvoice(id: number): Invoice {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    freelancer: 'GAFREELANCER',
    payer: 'GAPAYER',
    amount: '5000000',
    due_date: now + 86400,
    discount_rate: 100,
    status: 'Funded',
    funder: 'GLP',
    funded_at: now - 3600,
    created_at: now * 1000,
    updated_at: now * 1000,
  };
}

function sampleEvent() {
  return {
    eventId: 'evt-sample',
    type: 'funded',
    invoiceId: 1,
    freelancer: WALLET,
    payer: 'GAPAYER',
    amount: '1',
    dueDate: 0,
    discountRate: 0,
  };
}

function samplePayload(invoice: Invoice, eventId?: string): NotificationPayload {
  return {
    trigger: 'invoice_funded',
    invoice,
    recipientAddress: invoice.freelancer,
    actor: 'freelancer',
    subject: `Invoice #${invoice.id} funded`,
    message: `Your invoice #${invoice.id} has been funded.`,
    eventId,
  };
}

function fundedEvent(eventId: string, invoiceId: number): any {
  return {
    id: eventId,
    topic: [nativeToScVal('funded')],
    value: nativeToScVal(BigInt(invoiceId)),
    ledger: 1,
    ledgerClosedAt: new Date().toISOString(),
  };
}

function emailSubscription(address: string, destination: string) {
  return createSubscription({
    stellar_address: address,
    channel: 'email',
    destination,
    triggers: ['invoice_funded'],
    ownership_verified_at: Date.now(),
  });
}

function stubNoFallback(): void {
  deliverWithFallback.mockResolvedValue({
    attempted: false,
    success: false,
    priority: 'high',
    capacityAllowed: true,
    error: 'no fallback subscription',
  } as any);
}

/** Make every provider call fail; returns a counter of provider calls. */
function stubProviderFailure(message: string): () => number {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const spy = deliverNotification.mockRejectedValue(new Error(message));
  return () => spy.mock.calls.length;
}

function rawAttempts(): any[] {
  return db
    .prepare('SELECT * FROM dispatch_attempts ORDER BY created_at ASC, id ASC')
    .all() as any[];
}

function rawAttempt(id: string): any {
  return db.prepare('SELECT * FROM dispatch_attempts WHERE id = ?').get(id);
}

async function expectRejection(channel: string, stage: string, reason: string): Promise<void> {
  const metric = await notificationsMetrics.recipientRejectionsTotal.get();
  expect(metric.values).toContainEqual(
    expect.objectContaining({ labels: { channel, stage, reason }, value: 1 })
  );
}

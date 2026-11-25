import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, setDb } from '../src/db';
import {
  runRetentionSweep,
  getRetentionPolicySummary,
} from '../src/retention';

describe('Notification Data Retention and Exceptions (#1467)', () => {
  let db: any;

  beforeEach(() => {
    db = createDb(':memory:');
    setDb(db);
  });

  it('exports accurate retention policy configuration and deletion exceptions', () => {
    const summary = getRetentionPolicySummary();
    expect(summary.sentNotificationsDays).toBe(30);
    expect(summary.webhookDeliveryLogsDays).toBe(90);
    expect(summary.deliveryAuditLogDays).toBe(90);
    expect(summary.dispatchAttemptsDays).toBe(90);
    expect(summary.deletionExceptions).toContain(
      "dispatch_attempts with non-terminal status ('pending', 'retry_pending', 'in_progress')"
    );
  });

  it('purges expired sent_notifications (30d) and delivery logs (90d) on normal sweep', () => {
    const now = Date.now();
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
    const ninetyOneDaysAgo = now - 91 * 24 * 60 * 60 * 1000;
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;

    // Seed sent_notifications (one expired > 30d, one active)
    db.prepare(
      `INSERT INTO sent_notifications (invoice_id, trigger, recipient_address, channel, destination, event_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(1, 'funded', 'G_ADDR_1', 'email', 'user1@example.com', 'evt-expired', thirtyOneDaysAgo);

    db.prepare(
      `INSERT INTO sent_notifications (invoice_id, trigger, recipient_address, channel, destination, event_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(2, 'funded', 'G_ADDR_2', 'email', 'user2@example.com', 'evt-fresh', tenDaysAgo);

    // Seed subscription for foreign key constraint
    db.prepare(
      `INSERT INTO subscriptions (id, stellar_address, channel, destination, triggers, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(1, 'G_ADDR_1', 'webhook', 'https://webhook.site/test', '["funded"]', now);

    // Seed webhook_delivery_logs (one expired > 90d, one active)
    db.prepare(
      `INSERT INTO webhook_delivery_logs (subscription_id, event_id, trigger, invoice_id, recipient_address, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(1, 'evt-wh-expired', 'funded', 10, 'G_ADDR_1', 'success', 1, ninetyOneDaysAgo, ninetyOneDaysAgo);

    db.prepare(
      `INSERT INTO webhook_delivery_logs (subscription_id, event_id, trigger, invoice_id, recipient_address, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(1, 'evt-wh-fresh', 'funded', 20, 'G_ADDR_1', 'success', 1, tenDaysAgo, tenDaysAgo);

    const result = runRetentionSweep({ now, dryRun: false });

    expect(result.sentNotifications).toBe(1);
    expect(result.webhookLogs).toBe(1);

    // Verify remaining rows
    const remainingSent = db.prepare('SELECT COUNT(*) AS count FROM sent_notifications').get().count;
    expect(remainingSent).toBe(1);

    const remainingLogs = db.prepare('SELECT COUNT(*) AS count FROM webhook_delivery_logs').get().count;
    expect(remainingLogs).toBe(1);
  });

  it('preserves dispatch_attempts in non-terminal retry states as a deletion exception', () => {
    const now = Date.now();
    const ninetyFiveDaysAgo = now - 95 * 24 * 60 * 60 * 1000;

    // Terminal status > 90d -> should be purged
    db.prepare(
      `INSERT INTO dispatch_attempts (id, dedup_key, invoice_id, trigger, recipient_address, channel, destination, event_id, subscription, payload, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('att-1', 'key-1', 1, 'funded', 'G1', 'webhook', 'https://hook.com/1', 'e-1', '{}', '{}', 'delivered', 1, ninetyFiveDaysAgo);

    db.prepare(
      `INSERT INTO dispatch_attempts (id, dedup_key, invoice_id, trigger, recipient_address, channel, destination, event_id, subscription, payload, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('att-2', 'key-2', 2, 'funded', 'G2', 'webhook', 'https://hook.com/2', 'e-2', '{}', '{}', 'failed', 3, ninetyFiveDaysAgo);

    // Non-terminal status > 90d (pending retry) -> DELETION EXCEPTION
    db.prepare(
      `INSERT INTO dispatch_attempts (id, dedup_key, invoice_id, trigger, recipient_address, channel, destination, event_id, subscription, payload, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('att-3', 'key-3', 3, 'funded', 'G3', 'webhook', 'https://hook.com/3', 'e-3', '{}', '{}', 'pending', 1, ninetyFiveDaysAgo);

    const result = runRetentionSweep({ now, dryRun: false });

    // Only terminal statuses deleted (2)
    expect(result.dispatchAttempts).toBe(2);

    // Non-terminal attempts are safely preserved
    const remainingAttempts = db
      .prepare(`SELECT status FROM dispatch_attempts`)
      .all()
      .map((r: any) => r.status);

    expect(remainingAttempts).toEqual(['pending']);
  });

  it('aborts deletion fail-safe when eligible rows exceed maxRows limit', () => {
    const now = Date.now();
    const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000;

    // Seed 10 records
    for (let i = 0; i < 10; i++) {
      db.prepare(
        `INSERT INTO sent_notifications (invoice_id, trigger, recipient_address, channel, destination, event_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(i + 1, 'funded', `G_ADDR_${i}`, 'email', `user${i}@example.com`, `evt-${i}`, fortyDaysAgo);
    }

    // Set maxRows to 5: 10 eligible > 5 limit -> abort deletion!
    const result = runRetentionSweep({ now, dryRun: false, maxRows: 5 });

    expect(result.alertThresholdExceeded).toBe(true);
    expect(result.sentNotifications).toBe(0);

    // Live table remains untouched
    const count = db.prepare('SELECT COUNT(*) AS count FROM sent_notifications').get().count;
    expect(count).toBe(10);
  });

  it('records audit log without deleting records in dry-run mode', () => {
    const now = Date.now();
    const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000;

    db.prepare(
      `INSERT INTO sent_notifications (invoice_id, trigger, recipient_address, channel, destination, event_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(1, 'funded', 'G_ADDR_1', 'email', 'user1@example.com', 'evt-dry', fortyDaysAgo);

    const result = runRetentionSweep({ now, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.totalEligible).toBe(1);
    expect(result.sentNotifications).toBe(0);

    // Record remains in live table
    const count = db.prepare('SELECT COUNT(*) AS count FROM sent_notifications').get().count;
    expect(count).toBe(1);
  });
});

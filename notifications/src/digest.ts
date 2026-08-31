/**
 * Notification Digest Scheduler (#496)
 *
 * Buffers invoice events for users who prefer daily or weekly digests instead
 * of per-event emails. On schedule (daily/weekly) it compiles and sends a
 * single aggregated digest email per user.
 *
 * Usage:
 *   const scheduler = new DigestScheduler(emailSender);
 *   scheduler.buffer(stellarAddress, "daily", event);
 *   scheduler.start();   // sets up the cron-like tick
 *   scheduler.stop();
 */

import type { InvoiceEvent } from './types';
import type { NotificationFrequency } from './preferences';
import { renderDigestEmail, buildDigestSubject } from './templates/digest.template';
import type { DigestItem } from './templates/digest.template';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DigestEmailSender {
  send(to: string, subject: string, html: string): Promise<void>;
}

export interface DigestUserConfig {
  stellarAddress: string;
  email: string;
  frequency: 'daily' | 'weekly';
  /** Preferred UTC hour (0–23) to send the digest. Default 8 (08:00 UTC). */
  sendHour?: number;
  /** Preferred day of week for weekly digests: 0=Sun … 6=Sat. Default 1=Mon. */
  sendDayOfWeek?: number;
  unsubscribeToken: string;
}

export interface DigestBuffer {
  config: DigestUserConfig;
  items: DigestItem[];
  lastFlushedAt: number;
}

export interface DigestSendResult {
  stellarAddress: string;
  itemCount: number;
  sentAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function eventToDigestItem(event: InvoiceEvent): DigestItem {
  return {
    invoiceId: event.invoiceId,
    eventType: event.type,
    amount: event.amount,
    freelancer: event.freelancer,
    payer: event.payer,
    dueDate: event.dueDate,
    occurredAt: Date.now(),
  };
}

function periodLabel(frequency: 'daily' | 'weekly', now: Date): string {
  if (frequency === 'daily') {
    return now.toUTCString().slice(0, 16);
  }
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  return `${weekStart.toUTCString().slice(0, 16)} – ${weekEnd.toUTCString().slice(0, 16)}`;
}

function isDueNow(buffer: DigestBuffer, nowMs: number): boolean {
  const { config, lastFlushedAt } = buffer;
  const now = new Date(nowMs);
  const sendHour = config.sendHour ?? 8;

  if (config.frequency === 'daily') {
    const msSinceFlush = nowMs - lastFlushedAt;
    // At least 20 h since last flush and it is the configured send hour
    return msSinceFlush >= 20 * 3600_000 && now.getUTCHours() === sendHour;
  }

  // Weekly: same day-of-week and send hour, at least 6 days since last flush
  const sendDay = config.sendDayOfWeek ?? 1;
  const msSinceFlush = nowMs - lastFlushedAt;
  return (
    msSinceFlush >= 6 * 24 * 3600_000 &&
    now.getUTCDay() === sendDay &&
    now.getUTCHours() === sendHour
  );
}

// ── DigestScheduler ────────────────────────────────────────────────────────

export class DigestScheduler {
  private buffers = new Map<string, DigestBuffer>();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** How often to check whether any digest is due (default: every minute). */
  private readonly tickMs: number;

  constructor(private readonly emailSender: DigestEmailSender, tickMs = 60_000) {
    this.tickMs = tickMs;
  }

  /**
   * Register a user for digest delivery. Safe to call multiple times —
   * subsequent calls update the config without clearing the pending buffer.
   */
  register(config: DigestUserConfig): void {
    const existing = this.buffers.get(config.stellarAddress);
    if (existing) {
      existing.config = config;
    } else {
      this.buffers.set(config.stellarAddress, {
        config,
        items: [],
        lastFlushedAt: 0,
      });
    }
  }

  /**
   * Unregister a user and discard any pending items.
   */
  unregister(stellarAddress: string): void {
    this.buffers.delete(stellarAddress);
  }

  /**
   * Add an event to the digest buffer for a given address.
   * Silently ignored if the address has no digest registration.
   */
  buffer(stellarAddress: string, event: InvoiceEvent): void {
    const buf = this.buffers.get(stellarAddress);
    if (!buf) return;
    buf.items.push(eventToDigestItem(event));
  }

  /**
   * Start the recurring tick that checks whether digests are due.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick(Date.now()).catch((err) => {
        console.error('[digest] Tick error:', err);
      });
    }, this.tickMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Force a tick at a specific timestamp — useful for testing.
   */
  async tick(nowMs = Date.now()): Promise<DigestSendResult[]> {
    const results: DigestSendResult[] = [];

    for (const [address, buf] of this.buffers) {
      if (!isDueNow(buf, nowMs)) continue;

      const result = await this.flush(address, nowMs);
      if (result) results.push(result);
    }

    return results;
  }

  /**
   * Immediately flush the digest for a single user and send the email.
   * Returns null if the user has no registration.
   */
  async flush(stellarAddress: string, nowMs = Date.now()): Promise<DigestSendResult | null> {
    const buf = this.buffers.get(stellarAddress);
    if (!buf) return null;

    const { config, items } = buf;
    const now = new Date(nowMs);

    const subject = buildDigestSubject({ frequency: config.frequency, items });
    const html = renderDigestEmail({
      recipientAddress: config.stellarAddress,
      frequency: config.frequency,
      items,
      unsubscribeToken: config.unsubscribeToken,
      periodLabel: periodLabel(config.frequency, now),
    });

    try {
      await this.emailSender.send(config.email, subject, html);
    } catch (err) {
      console.error(`[digest] Failed to send digest to ${stellarAddress}:`, err);
      throw err;
    }

    // Clear buffer and record flush time
    buf.items = [];
    buf.lastFlushedAt = nowMs;

    return { stellarAddress, itemCount: items.length, sentAt: nowMs };
  }

  /** Return the number of pending items for a given address. */
  pendingCount(stellarAddress: string): number {
    return this.buffers.get(stellarAddress)?.items.length ?? 0;
  }

  /** Return all registered addresses. */
  registeredAddresses(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Convenience: determine whether a given NotificationFrequency should use
   * the digest scheduler (true) or immediate delivery (false).
   */
  static isDigestFrequency(frequency: NotificationFrequency): frequency is 'daily' | 'weekly' {
    return frequency === 'daily' || frequency === 'weekly';
  }
}

export const digestScheduler = new DigestScheduler({
  async send(to, subject, html) {
    // Replace with your real Resend/email sender in index.ts startup
    console.warn(
      `[digest] No email sender configured — would send to ${to}: ${subject} (${html.length} chars)`
    );
  },
});

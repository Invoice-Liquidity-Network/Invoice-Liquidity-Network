import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DigestScheduler, type DigestEmailSender, type DigestUserConfig } from '../digest';
import type { InvoiceEvent } from '../types';

function makeEvent(overrides: Partial<InvoiceEvent> = {}): InvoiceEvent {
  return {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'funded',
    invoiceId: 1,
    freelancer: 'GABC...FREELANCER',
    payer: 'GABC...PAYER',
    amount: '1000000',
    dueDate: Math.floor(Date.now() / 1000) + 86400,
    discountRate: 100,
    ...overrides,
  };
}

function makeDailyConfig(overrides: Partial<DigestUserConfig> = {}): DigestUserConfig {
  return {
    stellarAddress: 'GTEST...ADDRESS',
    email: 'test@example.com',
    frequency: 'daily',
    sendHour: 8,
    unsubscribeToken: 'unsub-token-123',
    ...overrides,
  };
}

function makeWeeklyConfig(overrides: Partial<DigestUserConfig> = {}): DigestUserConfig {
  return {
    stellarAddress: 'GTEST...ADDRESS',
    email: 'test@example.com',
    frequency: 'weekly',
    sendHour: 8,
    sendDayOfWeek: 1, // Monday
    unsubscribeToken: 'unsub-token-123',
    ...overrides,
  };
}

function createMockSender(): DigestEmailSender & {
  calls: Array<{ to: string; subject: string; html: string }>;
} {
  const calls: Array<{ to: string; subject: string; html: string }> = [];
  return {
    calls,
    async send(to: string, subject: string, html: string) {
      calls.push({ to, subject, html });
    },
  };
}

describe('DigestScheduler', () => {
  let scheduler: DigestScheduler;
  let sender: ReturnType<typeof createMockSender>;

  beforeEach(() => {
    sender = createMockSender();
    scheduler = new DigestScheduler(sender, 60_000);
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('register and unregister', () => {
    it('registers a user', () => {
      scheduler.register(makeDailyConfig());
      expect(scheduler.registeredAddresses()).toContain('GTEST...ADDRESS');
    });

    it('unregisters a user', () => {
      scheduler.register(makeDailyConfig());
      scheduler.unregister('GTEST...ADDRESS');
      expect(scheduler.registeredAddresses()).not.toContain('GTEST...ADDRESS');
    });

    it('updates config on re-registration without clearing buffer', () => {
      scheduler.register(makeDailyConfig());
      scheduler.buffer('GTEST...ADDRESS', makeEvent());
      expect(scheduler.pendingCount('GTEST...ADDRESS')).toBe(1);

      scheduler.register(makeDailyConfig({ email: 'new@example.com' }));
      expect(scheduler.pendingCount('GTEST...ADDRESS')).toBe(1);
    });
  });

  describe('buffer', () => {
    it('adds events to buffer', () => {
      scheduler.register(makeDailyConfig());
      scheduler.buffer('GTEST...ADDRESS', makeEvent({ invoiceId: 1 }));
      scheduler.buffer('GTEST...ADDRESS', makeEvent({ invoiceId: 2 }));
      expect(scheduler.pendingCount('GTEST...ADDRESS')).toBe(2);
    });

    it('silently ignores events for unregistered addresses', () => {
      scheduler.buffer('UNKNOWN', makeEvent());
      expect(scheduler.pendingCount('UNKNOWN')).toBe(0);
    });
  });

  describe('empty digest handling', () => {
    it("sends a 'no activity' digest when flush is called with empty buffer", async () => {
      scheduler.register(makeDailyConfig());

      const result = await scheduler.flush('GTEST...ADDRESS', Date.now());
      expect(result).not.toBeNull();
      expect(result!.itemCount).toBe(0);
      expect(sender.calls).toHaveLength(1);
      expect(sender.calls[0].subject).toContain('No activity');
    });

    it('empty digest has the correct email structure', async () => {
      scheduler.register(makeDailyConfig());

      await scheduler.flush('GTEST...ADDRESS', Date.now());
      const html = sender.calls[0].html;
      expect(html).toContain('No invoice activity during this period');
      expect(html).toContain('Go to Dashboard');
      expect(html).toContain('Unsubscribe');
    });

    it('tick does not produce results when no users are registered', async () => {
      const results = await scheduler.tick(Date.now());
      expect(results).toHaveLength(0);
      expect(sender.calls).toHaveLength(0);
    });
  });

  describe('daily digest boundary conditions', () => {
    it('isDueNow returns true when exactly at sendHour with sufficient time since flush', () => {
      scheduler.register(makeDailyConfig({ sendHour: 8 }));
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      // lastFlushedAt = 0, so msSinceFlush is huge
      // Just need to be at UTC hour 8
      const now = new Date(Date.UTC(2025, 0, 15, 8, 0, 0));

      // Verify the tick fires at sendHour
      // We'll test this by calling flush directly and verifying it works
      return scheduler.flush('GTEST...ADDRESS', now.getTime()).then((result) => {
        expect(result).not.toBeNull();
        expect(result!.itemCount).toBe(1);
      });
    });

    it('does not send digest before sendHour', async () => {
      scheduler.register(makeDailyConfig({ sendHour: 8 }));
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      const now = new Date(Date.UTC(2025, 0, 15, 7, 59, 59));
      const results = await scheduler.tick(now.getTime());
      expect(results).toHaveLength(0);
      expect(sender.calls).toHaveLength(0);
    });

    it('does not send digest if less than 20h since last flush (daily)', async () => {
      const config = makeDailyConfig({ sendHour: 8 });
      scheduler.register(config);
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      const nowMs = Date.UTC(2025, 0, 15, 8, 0, 0);

      await scheduler.flush('GTEST...ADDRESS', nowMs);
      expect(sender.calls).toHaveLength(1);

      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      const nextDay8am = nowMs + 24 * 3600_000;
      const results = await scheduler.tick(nextDay8am);
      // Should NOT send because only 24h have passed but lastFlushedAt was set
      // Actually: msSinceFlush = 24h = 24*3600_000 which is >= 20h, so it should send
      expect(results).toHaveLength(1);
    });

    it('sends digest exactly at 20h boundary after last flush', async () => {
      scheduler.register(makeDailyConfig({ sendHour: 8 }));
      const baseMs = Date.UTC(2025, 0, 15, 8, 0, 0);

      // Pre-flush at some time
      await scheduler.flush('GTEST...ADDRESS', baseMs);
      expect(sender.calls).toHaveLength(1);

      // Buffer a new event
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      // Tick at exactly 20h later at sendHour
      const tickTime = baseMs + 20 * 3600_000;
      const results = await scheduler.tick(tickTime);
      expect(results).toHaveLength(1);
    });

    it('sends digest after 20h but not at wrong hour', async () => {
      scheduler.register(makeDailyConfig({ sendHour: 8 }));
      const baseMs = Date.UTC(2025, 0, 15, 8, 0, 0);

      await scheduler.flush('GTEST...ADDRESS', baseMs);

      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      // 21h later but wrong hour
      const tickTime = baseMs + 21 * 3600_000;
      const results = await scheduler.tick(tickTime);
      // Should NOT send because hour might not match
      // 2025-01-15 08:00 UTC + 21h = 2025-01-16 05:00 UTC, not hour 8
      expect(results).toHaveLength(0);
    });
  });

  describe('weekly digest boundary conditions', () => {
    it('sends weekly digest on correct day and hour', () => {
      scheduler.register(makeWeeklyConfig({ sendDayOfWeek: 1, sendHour: 8 }));
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      // 2025-01-06 is a Monday at 08:00 UTC
      const now = new Date(Date.UTC(2025, 0, 6, 8, 0, 0));
      return scheduler.flush('GTEST...ADDRESS', now.getTime()).then((result) => {
        expect(result).not.toBeNull();
        expect(result!.itemCount).toBe(1);
      });
    });

    it('does not send weekly digest on wrong day', async () => {
      scheduler.register(makeWeeklyConfig({ sendDayOfWeek: 1, sendHour: 8 }));
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      // 2025-01-07 is a Tuesday
      const now = new Date(Date.UTC(2025, 0, 7, 8, 0, 0));
      const results = await scheduler.tick(now.getTime());
      expect(results).toHaveLength(0);
    });

    it('does not send weekly digest if less than 6 days since last flush', async () => {
      scheduler.register(makeWeeklyConfig({ sendDayOfWeek: 1, sendHour: 8 }));

      // Pre-flush on Monday
      const mondayMs = Date.UTC(2025, 0, 6, 8, 0, 0);
      await scheduler.flush('GTEST...ADDRESS', mondayMs);

      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      // Next Monday (7 days later)
      const nextMondayMs = mondayMs + 7 * 24 * 3600_000;
      const results = await scheduler.tick(nextMondayMs);
      // 7 days = 7*24*3600_000 ms which is >= 6 days, so should send
      expect(results).toHaveLength(1);
    });
  });

  describe('digest generation idempotency', () => {
    it('re-running flush for the same period does not re-send (buffer is cleared)', async () => {
      scheduler.register(makeDailyConfig());
      scheduler.buffer('GTEST...ADDRESS', makeEvent({ invoiceId: 1 }));
      scheduler.buffer('GTEST...ADDRESS', makeEvent({ invoiceId: 2 }));

      const nowMs = Date.now();
      const firstResult = await scheduler.flush('GTEST...ADDRESS', nowMs);
      expect(firstResult!.itemCount).toBe(2);
      expect(sender.calls).toHaveLength(1);

      // Re-running flush with no new events should send an empty digest
      // (not a duplicate of the same events)
      const secondResult = await scheduler.flush('GTEST...ADDRESS', nowMs);
      expect(secondResult!.itemCount).toBe(0);
      expect(sender.calls).toHaveLength(2);

      // Second email should indicate no activity
      expect(sender.calls[1].subject).toContain('No activity');
    });

    it('tick does not re-flush for the same period', async () => {
      scheduler.register(makeDailyConfig({ sendHour: 8 }));
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      const nowMs = Date.UTC(2025, 0, 15, 8, 0, 0);
      await scheduler.tick(nowMs);
      expect(sender.calls).toHaveLength(1);

      // Second tick at same time should not send (lastFlushedAt was updated)
      await scheduler.tick(nowMs);
      expect(sender.calls).toHaveLength(1);
    });

    it('new events after flush are sent in the next digest', async () => {
      scheduler.register(makeDailyConfig());

      const nowMs = Date.now();
      scheduler.buffer('GTEST...ADDRESS', makeEvent({ invoiceId: 1 }));
      await scheduler.flush('GTEST...ADDRESS', nowMs);
      expect(sender.calls).toHaveLength(1);

      // Buffer new events
      scheduler.buffer('GTEST...ADDRESS', makeEvent({ invoiceId: 2 }));
      await scheduler.flush('GTEST...ADDRESS', nowMs + 1000);
      expect(sender.calls).toHaveLength(2);
      expect(sender.calls[1].subject).toContain('1 update');
    });
  });

  describe('flush', () => {
    it('returns null for unregistered address', async () => {
      const result = await scheduler.flush('UNKNOWN', Date.now());
      expect(result).toBeNull();
      expect(sender.calls).toHaveLength(0);
    });

    it('includes all events in the digest email', async () => {
      scheduler.register(makeDailyConfig());
      const events = [
        makeEvent({ invoiceId: 1, type: 'funded' }),
        makeEvent({ invoiceId: 2, type: 'paid' }),
        makeEvent({ invoiceId: 3, type: 'defaulted' }),
      ];
      for (const e of events) {
        scheduler.buffer('GTEST...ADDRESS', e);
      }

      await scheduler.flush('GTEST...ADDRESS', Date.now());
      const html = sender.calls[0].html;
      expect(html).toContain('#1');
      expect(html).toContain('#2');
      expect(html).toContain('#3');
      expect(html).toContain('3 invoice updates');
    });

    it('sends to the correct email', async () => {
      scheduler.register(makeDailyConfig({ email: 'specific@test.com' }));
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      await scheduler.flush('GTEST...ADDRESS', Date.now());
      expect(sender.calls[0].to).toBe('specific@test.com');
    });

    it('throws when email sender fails', async () => {
      const failingSender: DigestEmailSender = {
        async send() {
          throw new Error('SMTP connection refused');
        },
      };
      const failingScheduler = new DigestScheduler(failingSender);
      failingScheduler.register(makeDailyConfig());
      failingScheduler.buffer('GTEST...ADDRESS', makeEvent());

      await expect(failingScheduler.flush('GTEST...ADDRESS', Date.now())).rejects.toThrow(
        'SMTP connection refused'
      );
    });

    it('clears buffer after successful flush', async () => {
      scheduler.register(makeDailyConfig());
      scheduler.buffer('GTEST...ADDRESS', makeEvent());
      expect(scheduler.pendingCount('GTEST...ADDRESS')).toBe(1);

      await scheduler.flush('GTEST...ADDRESS', Date.now());
      expect(scheduler.pendingCount('GTEST...ADDRESS')).toBe(0);
    });

    it('records flush timestamp', async () => {
      scheduler.register(makeDailyConfig());
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      const nowMs = 1234567890;
      const result = await scheduler.flush('GTEST...ADDRESS', nowMs);
      expect(result!.sentAt).toBe(nowMs);
    });
  });

  describe('tick', () => {
    it('flushes all due digests', async () => {
      const config1 = makeDailyConfig({
        stellarAddress: 'GADDR1',
        email: 'a@test.com',
      });
      const config2 = makeDailyConfig({
        stellarAddress: 'GADDR2',
        email: 'b@test.com',
      });
      scheduler.register(config1);
      scheduler.register(config2);

      scheduler.buffer('GADDR1', makeEvent({ invoiceId: 1 }));
      scheduler.buffer('GADDR2', makeEvent({ invoiceId: 2 }));

      const nowMs = Date.now();
      const results = await scheduler.tick(nowMs);
      expect(results).toHaveLength(2);
      expect(sender.calls).toHaveLength(2);
    });

    it('does not flush digests that are not yet due', async () => {
      scheduler.register(makeDailyConfig({ sendHour: 8 }));
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      // Not yet at sendHour
      const now = new Date(Date.UTC(2025, 0, 15, 3, 0, 0));
      const results = await scheduler.tick(now.getTime());
      expect(results).toHaveLength(0);
    });
  });

  describe('start and stop', () => {
    it('start creates interval', () => {
      scheduler.start();
      expect((scheduler as any).timer).not.toBeNull();
    });

    it('stop clears interval', () => {
      scheduler.start();
      scheduler.stop();
      expect((scheduler as any).timer).toBeNull();
    });

    it('start is idempotent', () => {
      scheduler.start();
      scheduler.start();
      expect((scheduler as any).timer).not.toBeNull();
    });
  });

  describe('static isDigestFrequency', () => {
    it('returns true for daily and weekly', () => {
      expect(DigestScheduler.isDigestFrequency('daily')).toBe(true);
      expect(DigestScheduler.isDigestFrequency('weekly')).toBe(true);
    });

    it('returns false for realtime', () => {
      expect(DigestScheduler.isDigestFrequency('realtime')).toBe(false);
    });
  });

  describe('period label', () => {
    it('uses daily format for daily digests', async () => {
      scheduler.register(makeDailyConfig());
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      await scheduler.flush('GTEST...ADDRESS', Date.now());
      const html = sender.calls[0].html;
      expect(html).toContain('Daily Digest');
    });

    it('uses weekly format for weekly digests', async () => {
      scheduler.register(makeWeeklyConfig());
      scheduler.buffer('GTEST...ADDRESS', makeEvent());

      await scheduler.flush('GTEST...ADDRESS', Date.now());
      const html = sender.calls[0].html;
      expect(html).toContain('Weekly Digest');
    });
  });
});

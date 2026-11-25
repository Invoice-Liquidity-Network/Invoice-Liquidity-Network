import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter, RateLimiterSnapshot } from '../src/rate-limiter';

describe('RateLimiter Persistence and Replay Hardening (#1465)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe('Process Restart Persistence', () => {
    it('preserves rate-limit counters and remaining allowance across simulated process restart', () => {
      vi.useFakeTimers();
      const now = 100_000;
      vi.setSystemTime(now);

      const config = {
        perUserLimit: 5,
        perRecipientLimit: 10,
        windowMs: 60_000,
      };

      const instance1 = new RateLimiter(config);
      expect(instance1.check('user_123', 'email').allowed).toBe(true);
      const second = instance1.check('user_123', 'email');
      expect(second.allowed).toBe(true);
      expect(second.remaining).toBe(3);

      // Export state before process exit
      const snapshot: RateLimiterSnapshot = instance1.exportState(now);
      expect(snapshot.userBuckets['user_123']).toBeDefined();
      expect(snapshot.userBuckets['user_123'].timestamps).toHaveLength(2);

      // Simulate new process starting 10s later
      vi.setSystemTime(now + 10_000);
      const instance2 = new RateLimiter(config);
      instance2.importState(snapshot, now + 10_000);

      // Remaining should still reflect the previous 2 requests (5 total - 2 = 3; 3rd request leaves 2)
      const result = instance2.check('user_123', 'email');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);

      // 4th request
      expect(instance2.check('user_123', 'email').remaining).toBe(1);
      // 5th request hits limit
      expect(instance2.check('user_123', 'email').remaining).toBe(0);
      // 6th request is blocked
      const blocked = instance2.check('user_123', 'email');
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    it('prunes expired timestamps when restoring state after a long restart downtime', () => {
      vi.useFakeTimers();
      const now = 100_000;
      vi.setSystemTime(now);

      const config = {
        perUserLimit: 2,
        perRecipientLimit: 5,
        windowMs: 60_000,
      };

      const instance1 = new RateLimiter(config);
      instance1.check('user_123', 'email');
      instance1.check('user_123', 'email');
      expect(instance1.check('user_123', 'email').allowed).toBe(false);

      const snapshot = instance1.exportState(now);

      // Process was down for 70s (greater than 60s window)
      vi.setSystemTime(now + 70_000);
      const instance2 = new RateLimiter(config);
      instance2.importState(snapshot, now + 70_000);

      // Full quota should be available again
      const refreshed = instance2.check('user_123', 'email');
      expect(refreshed.allowed).toBe(true);
      expect(refreshed.remaining).toBe(1);
    });
  });

  describe('Distributed Worker Synchronization', () => {
    it('merges rate-limit states from multiple concurrent workers without dropping counts', () => {
      vi.useFakeTimers();
      const now = 200_000;
      vi.setSystemTime(now);

      const config = {
        perUserLimit: 5,
        perRecipientLimit: 10,
        windowMs: 60_000,
      };

      const workerA = new RateLimiter(config);
      const workerB = new RateLimiter(config);

      // Worker A processes 2 requests
      workerA.check('stellar_user', 'webhook');
      workerA.check('stellar_user', 'webhook');

      // Worker B processes 2 requests
      workerB.check('stellar_user', 'webhook');
      workerB.check('stellar_user', 'webhook');

      // Shared persistence sync: export from both and import into Worker A
      const snapB = workerB.exportState(now);
      workerA.importState(snapB, now);

      // Worker A now knows about all 4 requests; 5th should be allowed, 6th blocked
      const fifth = workerA.check('stellar_user', 'webhook');
      expect(fifth.allowed).toBe(true);
      expect(fifth.remaining).toBe(0);

      const sixth = workerA.check('stellar_user', 'webhook');
      expect(sixth.allowed).toBe(false);
    });
  });

  describe('Replay Burst Containment', () => {
    it('throttles rapid duplicate event replay bursts within the window', () => {
      vi.useFakeTimers();
      const now = 500_000;
      vi.setSystemTime(now);

      const limiter = new RateLimiter({
        perUserLimit: 3,
        perRecipientLimit: 5,
        windowMs: 10_000,
      });

      // Rapid replay burst of 10 requests at the same timestamp
      const outcomes = [];
      for (let i = 0; i < 10; i++) {
        outcomes.push(limiter.check('replayed_user', 'email').allowed);
      }

      // Exactly 3 allowed, 7 blocked
      expect(outcomes.filter((a) => a === true)).toHaveLength(3);
      expect(outcomes.filter((a) => a === false)).toHaveLength(7);

      // Advance clock past the burst window
      vi.setSystemTime(now + 10_001);
      expect(limiter.check('replayed_user', 'email').allowed).toBe(true);
    });

    it('correctly calculates resetAt for replayed events', () => {
      vi.useFakeTimers();
      const now = 1_000_000;
      vi.setSystemTime(now);

      const limiter = new RateLimiter({
        perUserLimit: 1,
        perRecipientLimit: 5,
        windowMs: 15_000,
      });

      const first = limiter.check('burst_user', 'email');
      expect(first.allowed).toBe(true);
      expect(first.resetAt).toBe(Math.ceil((now + 15_000) / 1000));

      const blocked = limiter.check('burst_user', 'email');
      expect(blocked.allowed).toBe(false);
      expect(blocked.resetAt).toBe(Math.ceil((now + 15_000) / 1000));
    });
  });
});

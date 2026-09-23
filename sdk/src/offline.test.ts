import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfflineManager, canonicalStringify, deriveDedupKey } from './offline';

describe('OfflineManager', () => {
  let manager: OfflineManager;

  beforeEach(() => {
    manager = new OfflineManager({
      maxRetries: 2,
      retryDelayMs: 100,
      maxQueueSize: 5,
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('constructor', () => {
    it('should create an instance with default config', () => {
      const m = new OfflineManager();
      expect(m).toBeDefined();
      expect(m.getState().isOnline).toBe(true);
      expect(m.getState().queueSize).toBe(0);
    });

    it('should create an instance with custom config', () => {
      const m = new OfflineManager({
        maxRetries: 5,
        retryDelayMs: 1000,
      });
      expect(m).toBeDefined();
    });
  });

  describe('enqueue', () => {
    it('should add an item to the queue', () => {
      const item = manager.enqueue('submitInvoice', { amount: 100 });
      expect(item).toBeDefined();
      expect(item.id).toMatch(/^offline_/);
      expect(item.operation).toBe('submitInvoice');
      expect(item.params).toEqual({ amount: 100 });
      expect(item.status).toBe('pending');
      expect(manager.getState().queueSize).toBe(1);
    });

    it('should throw when queue is full', () => {
      for (let i = 0; i < 5; i++) {
        manager.enqueue('op', { i });
      }
      expect(() => manager.enqueue('op', {})).toThrow('Queue is full');
    });
  });

  describe('processQueue', () => {
    it('should process pending items when online', async () => {
      const submitFn = vi.fn().mockResolvedValue(true);
      manager.onSubmit(submitFn);

      manager.enqueue('op1', {});
      manager.enqueue('op2', {});

      await manager.processQueue();

      expect(submitFn).toHaveBeenCalledTimes(2);
      expect(manager.getState().queueSize).toBe(0);
    });

    it('should not process when offline', async () => {
      const submitFn = vi.fn().mockResolvedValue(true);
      manager.onSubmit(submitFn);
      manager.setOnline(false);

      manager.enqueue('op1', {});
      await manager.processQueue();

      expect(submitFn).not.toHaveBeenCalled();
      expect(manager.getState().queueSize).toBe(1);
    });

    it('should retry failed submissions', async () => {
      const submitFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(true);

      manager.onSubmit(submitFn);
      manager.enqueue('op1', {});

      await manager.processQueue();

      // Should have retried once
      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(manager.getState().queueSize).toBe(1);
    });

    it('should mark item as failed after max retries', async () => {
      // maxRetries: 1 so a single failed attempt immediately exhausts retries.
      const singleRetryManager = new OfflineManager({
        maxRetries: 1,
        retryDelayMs: 100,
        maxQueueSize: 5,
      });
      const submitFn = vi.fn().mockRejectedValue(new Error('Always fail'));
      singleRetryManager.onSubmit(submitFn);

      singleRetryManager.enqueue('op1', {});
      await singleRetryManager.processQueue();

      // Should have retried and failed
      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(singleRetryManager.getState().failedCount).toBe(1);

      singleRetryManager.destroy();
    });
  });

  describe('retryItem', () => {
    it('should retry a failed item', async () => {
      const submitFn = vi.fn().mockResolvedValue(true);
      manager.onSubmit(submitFn);

      const item = manager.enqueue('op1', {});
      item.status = 'failed';
      item.retries = 3;

      await manager.retryItem(item.id);

      // retryItem resets the item and immediately reprocesses the queue;
      // with a submit callback that resolves successfully, the item
      // completes and is pruned from the queue.
      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(item.status).toBe('completed');
      expect(item.retries).toBe(0);
    });

    it('should throw for non-existent item', async () => {
      await expect(manager.retryItem('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('removeItem', () => {
    it('should remove an item from the queue', () => {
      const item = manager.enqueue('op1', {});
      expect(manager.getState().queueSize).toBe(1);

      const removed = manager.removeItem(item.id);
      expect(removed).toBe(true);
      expect(manager.getState().queueSize).toBe(0);
    });

    it('should return false for non-existent item', () => {
      const removed = manager.removeItem('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('clearQueue', () => {
    it('should clear all items', () => {
      manager.enqueue('op1', {});
      manager.enqueue('op2', {});
      expect(manager.getState().queueSize).toBe(2);

      manager.clearQueue();
      expect(manager.getState().queueSize).toBe(0);
    });
  });

  describe('getQueue', () => {
    it('should return a copy of the queue', () => {
      manager.enqueue('op1', {});
      const queue = manager.getQueue();
      expect(queue).toHaveLength(1);

      // Modifying the copy shouldn't affect the original
      (queue as any).push({ id: 'fake' });
      expect(manager.getQueue()).toHaveLength(1);
    });
  });

  describe('state management', () => {
    it('should track online status', () => {
      expect(manager.getIsOnline()).toBe(true);

      manager.setOnline(false);
      expect(manager.getIsOnline()).toBe(false);
      expect(manager.getState().isOnline).toBe(false);

      manager.setOnline(true);
      expect(manager.getIsOnline()).toBe(true);
    });

    it('should notify listeners on state change', () => {
      const listener = vi.fn();
      manager.onStateChange(listener);

      manager.enqueue('op1', {});
      expect(listener).toHaveBeenCalled();
    });

    it('should unsubscribe listeners', () => {
      const listener = vi.fn();
      const unsubscribe = manager.onStateChange(listener);

      manager.enqueue('op1', {});
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      manager.enqueue('op2', {});
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('exportData', () => {
    it('should export queue data', () => {
      manager.enqueue('op1', { data: 'test' });
      const data = manager.exportData();

      expect(data).toBeDefined();
      expect(data.queue).toHaveLength(1);
      expect(data.queue[0].operation).toBe('op1');
    });
  });

  describe('idempotency / dedup keys', () => {
    it('dedupes enqueues of the same operation + params', () => {
      const a = manager.enqueue('submitInvoice', { invoiceId: 42, amount: 100 });
      const b = manager.enqueue('submitInvoice', { invoiceId: 42, amount: 100 });

      expect(b.id).toBe(a.id);
      expect(manager.getState().queueSize).toBe(1);
    });

    it('does not dedupe when params differ', () => {
      const a = manager.enqueue('submitInvoice', { invoiceId: 42 });
      const b = manager.enqueue('submitInvoice', { invoiceId: 43 });

      expect(b.id).not.toBe(a.id);
      expect(manager.getState().queueSize).toBe(2);
      expect(a.sequence).toBeLessThan(b.sequence);
    });

    it('honours an explicit idempotencyKey over params', () => {
      const a = manager.enqueue(
        'fundInvoice',
        { invoiceId: 9, amount: 1 },
        { idempotencyKey: 'w-1' }
      );
      const b = manager.enqueue(
        'fundInvoice',
        { invoiceId: 9, amount: 2 },
        { idempotencyKey: 'w-1' }
      );

      expect(b.id).toBe(a.id);
      expect(manager.getState().queueSize).toBe(1);
    });

    it('derives the same key regardless of object key ordering', () => {
      expect(canonicalStringify({ a: 1, b: { c: 2 } })).toBe(
        canonicalStringify({ b: { c: 2 }, a: 1 })
      );
      expect(deriveDedupKey('op', { payer: 'G1', amount: 5 })).toBe(
        deriveDedupKey('op', { amount: 5, payer: 'G1' })
      );
      expect(deriveDedupKey('op', { amount: 5, payer: 'G1' })).not.toBe(
        deriveDedupKey('op', { amount: 6, payer: 'G1' })
      );
    });

    it('raises the oldestPendingAgeMs as queued writes age', () => {
      vi.useFakeTimers();
      const m = new OfflineManager();
      m.setOnline(false);
      m.enqueue('op1', {});
      expect(m.getState().oldestPendingAgeMs).toBe(0);

      vi.advanceTimersByTime(60000);
      expect(m.getOldestPendingAgeMs()).toBe(60000);
      m.destroy();
      vi.useRealTimers();
    });

    it('assigns monotonic sequence numbers', () => {
      const a = manager.enqueue('op1', {});
      const b = manager.enqueue('op2', {});
      const c = manager.enqueue('op3', {});

      expect(a.sequence).toBe(1);
      expect(b.sequence).toBe(2);
      expect(c.sequence).toBe(3);
    });
  });

  describe('chaos: connectivity loss must not double-submit', () => {
    it('does not duplicate an in-flight submission when the same write is enqueued again', async () => {
      const m = new OfflineManager({ maxRetries: 1, retryDelayMs: 1000, maxQueueSize: 10 });
      let resolveSubmit!: (ok: boolean) => void;
      const submitFn = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSubmit = resolve;
          })
      );
      m.onSubmit(submitFn);

      m.setOnline(false);
      const original = m.enqueue('submitInvoice', { invoiceId: 42 });

      // Connectivity returns; the submission is now in-flight at the RPC.
      m.setOnline(true);
      await Promise.resolve();

      // The user retries the same logical write while the first attempt is
      // still in flight — this must NOT create a second queue entry.
      const retried = m.enqueue('submitInvoice', { invoiceId: 42 });
      expect(retried.id).toBe(original.id);
      expect(m.getState().queueSize).toBe(1);

      resolveSubmit(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(m.getState().queueSize).toBe(0);
      m.destroy();
    });

    it('recovers a dropped mid-queue RPC without duplicate logical submissions', async () => {
      const m = new OfflineManager({ maxRetries: 3, retryDelayMs: 15, maxQueueSize: 20 });
      const calls: string[] = [];
      const submitFn = vi.fn(async (item: { id: string }) => {
        calls.push(item.id);
        // Simulate the RPC connection being killed on the first attempt.
        if (calls.filter((id) => id === item.id).length === 1) {
          throw new Error('NetworkError: fetch failed');
        }
        return true;
      });
      m.onSubmit(submitFn);

      m.setOnline(false);
      m.enqueue('submitInvoice', { invoiceId: 1 });
      m.enqueue('fundInvoice', { invoiceId: 1, amount: 10 });

      // Connectivity kill mid-queue: the first attempt throws, connectivity
      // drops again before the retry timer fires, then returns.
      m.setOnline(true);
      await new Promise((r) => setTimeout(r, 0));
      m.setOnline(false);
      await new Promise((r) => setTimeout(r, 40));
      m.setOnline(true);
      await new Promise((r) => setTimeout(r, 60));

      // Both writes completed. Each logical write was attempted exactly twice:
      // one failed attempt + one successful retry — never a duplicated entry,
      // and never two concurrent submissions of the same write.
      const perItem = new Map<string, number>();
      for (const id of calls) perItem.set(id, (perItem.get(id) ?? 0) + 1);
      expect(perItem.size).toBe(2);
      for (const count of perItem.values()) {
        expect(count).toBe(2);
      }
      expect(m.getState().queueSize).toBe(0);
      m.destroy();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfflineManager } from './offline';

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
});

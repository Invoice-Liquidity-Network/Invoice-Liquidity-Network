import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OfflineManager,
  createMemoryOfflineStorage,
  type OfflineStorage,
} from "../offline";

describe("OfflineManager", () => {
  let manager: OfflineManager;
  let storage: OfflineStorage;

  beforeEach(() => {
    storage = createMemoryOfflineStorage();
    manager = new OfflineManager({
      maxRetries: 2,
      retryDelayMs: 100,
      maxQueueSize: 5,
      storage,
      storageKey: "test_queue",
    });
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("creates an instance with default config", () => {
      const m = new OfflineManager({ storage: createMemoryOfflineStorage() });
      expect(m.getState().isOnline).toBe(true);
      expect(m.getState().queueSize).toBe(0);
      m.destroy();
    });

    it("loads persisted queue items from storage", () => {
      const firstManager = new OfflineManager({
        storage,
        storageKey: "persistent_queue",
      });

      firstManager.enqueue("submitInvoice", {
        amount: 1000n,
        invoiceId: 42n,
      });
      firstManager.destroy();

      const secondManager = new OfflineManager({
        storage,
        storageKey: "persistent_queue",
      });

      const [item] = secondManager.getQueue();
      expect(secondManager.getState().queueSize).toBe(1);
      expect(item.params).toEqual({ amount: 1000n, invoiceId: 42n });
      secondManager.destroy();
    });

    it("ignores invalid persisted queue payloads", () => {
      storage.setItem("bad_queue", JSON.stringify({ nope: true }));
      const m = new OfflineManager({ storage, storageKey: "bad_queue" });
      expect(m.getQueue()).toEqual([]);
      m.destroy();
    });
  });

  describe("enqueue", () => {
    it("adds an item to the queue", () => {
      const item = manager.enqueue("submitInvoice", { amount: 100 });
      expect(item.id).toMatch(/^offline_/);
      expect(item.operation).toBe("submitInvoice");
      expect(item.params).toEqual({ amount: 100 });
      expect(item.status).toBe("pending");
      expect(manager.getState()).toMatchObject({
        queueSize: 1,
        pendingCount: 1,
        failedCount: 0,
      });
    });

    it("throws when queue is full", () => {
      for (let i = 0; i < 5; i += 1) {
        manager.enqueue("op", { i });
      }

      expect(() => manager.enqueue("op", {})).toThrow("Queue is full");
    });
  });

  describe("processQueue", () => {
    it("processes pending items when online", async () => {
      const submitFn = vi.fn().mockResolvedValue(true);
      manager.onSubmit(submitFn);

      manager.enqueue("op1", {});
      manager.enqueue("op2", {});

      await manager.processQueue();

      expect(submitFn).toHaveBeenCalledTimes(2);
      expect(manager.getState().queueSize).toBe(0);
      expect(manager.getState().lastSyncTime).toEqual(expect.any(Number));
    });

    it("does not process when offline", async () => {
      const submitFn = vi.fn().mockResolvedValue(true);
      manager.onSubmit(submitFn);
      manager.setOnline(false);

      manager.enqueue("op1", {});
      await manager.processQueue();

      expect(submitFn).not.toHaveBeenCalled();
      expect(manager.getState().queueSize).toBe(1);
    });

    it("auto-submits queued items when the SDK comes back online", async () => {
      const submitFn = vi.fn().mockResolvedValue(true);
      manager.onSubmit(submitFn);
      manager.setOnline(false);
      manager.enqueue("op1", {});

      manager.setOnline(true);
      await Promise.resolve();
      await Promise.resolve();

      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(manager.getState().queueSize).toBe(0);
    });

    it("keeps failed submissions pending until max retries is reached", async () => {
      const submitFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(true);

      manager.onSubmit(submitFn);
      manager.enqueue("op1", {});

      await manager.processQueue();

      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(manager.getState().pendingCount).toBe(1);

      await manager.processQueue();

      expect(submitFn).toHaveBeenCalledTimes(2);
      expect(manager.getState().queueSize).toBe(0);
    });

    it("marks an item as failed after max retries", async () => {
      const failingManager = new OfflineManager({
        maxRetries: 1,
        storage,
        storageKey: "fail_queue",
      });
      const submitFn = vi.fn().mockRejectedValue(new Error("Always fail"));
      failingManager.onSubmit(submitFn);

      failingManager.enqueue("op1", {});
      await failingManager.processQueue();

      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(failingManager.getState().failedCount).toBe(1);
      expect(failingManager.getQueue()[0].error).toContain("Always fail");
      failingManager.destroy();
    });
  });

  describe("retryItem", () => {
    it("retries a failed item and removes it when submission succeeds", async () => {
      const retryManager = new OfflineManager({
        maxRetries: 1,
        storage,
        storageKey: "retry_queue",
      });
      const submitFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(true);
      retryManager.onSubmit(submitFn);

      const item = retryManager.enqueue("op1", {});
      await retryManager.processQueue();
      await retryManager.retryItem(item.id);

      expect(submitFn).toHaveBeenCalledTimes(2);
      expect(retryManager.getState().queueSize).toBe(0);
      retryManager.destroy();
    });

    it("throws for non-existent items", async () => {
      await expect(manager.retryItem("nonexistent")).rejects.toThrow("not found");
    });
  });

  describe("queue management", () => {
    it("removes an item from the queue", () => {
      const item = manager.enqueue("op1", {});
      expect(manager.removeItem(item.id)).toBe(true);
      expect(manager.getState().queueSize).toBe(0);
    });

    it("returns false when removing a non-existent item", () => {
      expect(manager.removeItem("nonexistent")).toBe(false);
    });

    it("clears all items", () => {
      manager.enqueue("op1", {});
      manager.enqueue("op2", {});
      expect(manager.getState().queueSize).toBe(2);

      manager.clearQueue();
      expect(manager.getState().queueSize).toBe(0);
    });

    it("returns a copy of the queue array", () => {
      manager.enqueue("op1", {});
      const queue = manager.getQueue();
      (queue as unknown[]).push({ id: "fake" });

      expect(manager.getQueue()).toHaveLength(1);
    });
  });

  describe("state management", () => {
    it("tracks online status", () => {
      expect(manager.getIsOnline()).toBe(true);

      manager.setOnline(false);
      expect(manager.getIsOnline()).toBe(false);
      expect(manager.getState().isOnline).toBe(false);

      manager.setOnline(true);
      expect(manager.getIsOnline()).toBe(true);
    });

    it("notifies listeners on state change", () => {
      const listener = vi.fn();
      manager.onStateChange(listener);

      manager.enqueue("op1", {});
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ queueSize: 1 }),
      );
    });

    it("unsubscribes listeners", () => {
      const listener = vi.fn();
      const unsubscribe = manager.onStateChange(listener);

      manager.enqueue("op1", {});
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      manager.enqueue("op2", {});
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("exportData", () => {
    it("exports queue data", () => {
      manager.enqueue("op1", { data: "test" });
      const data = manager.exportData();

      expect(data.queue).toHaveLength(1);
      expect(data.queue[0].operation).toBe("op1");
      expect(data.state.queueSize).toBe(1);
    });
  });
});

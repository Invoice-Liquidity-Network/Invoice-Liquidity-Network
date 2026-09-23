/**
 * SDK Offline Support
 *
 * Provides offline detection, transaction queuing, and auto-submit on reconnect.
 */

import { createLogger } from './logger';

const logger = createLogger('offline');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OfflineQueueItem {
  id: string;
  operation: string;
  params: unknown;
  timestamp: number;
  retries: number;
  maxRetries: number;
  status: 'pending' | 'submitting' | 'failed' | 'completed';
  error?: string;
  /**
   * Deterministic key derived from `(operation, params)` (or passed explicitly
   * by the caller). Re-enqueuing an operation with the same key while a copy is
   * still pending or submitting is a no-op — this is the idempotency guarantee
   * that prevents a flaky reconnect from double-submitting a write.
   */
  dedupKey?: string;
  /**
   * Monotonic sequence number assigned at enqueue time. Persisted replay order;
   * consumers can use it to guarantee writes execute exactly-once in order.
   */
  sequence: number;
}

export interface OfflineConfig {
  /** Maximum number of retries for failed submissions */
  maxRetries?: number;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number;
  /** Maximum queue size */
  maxQueueSize?: number;
  /** Storage key for persistence */
  storageKey?: string;
  /** Custom storage adapter (defaults to localStorage) */
  storage?: OfflineStorage;
}

export interface OfflineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OfflineState {
  isOnline: boolean;
  queueSize: number;
  pendingCount: number;
  failedCount: number;
  /** Milliseconds since the oldest pending/submitting item was enqueued (0 when idle). */
  oldestPendingAgeMs: number;
}

export type StateChangeCallback = (state: OfflineState) => void;
export type SubmitCallback = (item: OfflineQueueItem) => Promise<boolean>;

/**
 * Thrown by SDK write methods when the offline queue is enabled and the
 * client is currently offline. Catch this error to present a "queued" state
 * to the user — the operation will be retried automatically when connectivity
 * is restored.
 */
export class OfflineQueuedError extends Error {
  public readonly item: OfflineQueueItem;

  constructor(item: OfflineQueueItem) {
    super(`Operation "${item.operation}" queued for submission when back online (id: ${item.id})`);
    this.name = 'OfflineQueuedError';
    this.item = item;
  }
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Omit<Required<OfflineConfig>, 'storage'> = {
  maxRetries: 3,
  retryDelayMs: 5000,
  maxQueueSize: 100,
  storageKey: 'iln_offline_queue',
};

function createMemoryStorage(): OfflineStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
}

/**
 * Canonical JSON stringify: object keys are sorted recursively so two
 * semantically-identical param objects produce the same stability key even when
 * their key insertion orders differ.
 */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Default dedup key derivation from an operation name and its params. */
export function deriveDedupKey(operation: string, params: unknown): string {
  return `${operation}:${canonicalStringify(params)}`;
}

// ---------------------------------------------------------------------------
// OfflineManager
// ---------------------------------------------------------------------------

export class OfflineManager {
  private queue: OfflineQueueItem[] = [];
  private config: Required<OfflineConfig>;
  private isOnline: boolean =
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true;
  private listeners: Set<StateChangeCallback> = new Set();
  private submitCallback: SubmitCallback | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: OfflineConfig = {}) {
    const storage =
      config.storage ??
      (typeof localStorage !== 'undefined' ? localStorage : createMemoryStorage());
    this.config = { ...DEFAULT_CONFIG, storage, ...config };
    this.loadQueue();
    this.setupEventListeners();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Register a callback to submit queued items when online.
   */
  onSubmit(callback: SubmitCallback): void {
    this.submitCallback = callback;
  }

  /**
   * Subscribe to state changes.
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get the current offline state, including the age of the oldest queued item.
   */
  getState(): OfflineState {
    const pending = this.queue.filter((i) => i.status === 'pending' || i.status === 'submitting');
    const oldestTimestamp = pending.reduce(
      (oldest, i) => (i.timestamp < oldest ? i.timestamp : oldest),
      Number.POSITIVE_INFINITY
    );
    return {
      isOnline: this.isOnline,
      queueSize: this.queue.length,
      pendingCount: pending.length,
      failedCount: this.queue.filter((i) => i.status === 'failed').length,
      oldestPendingAgeMs: pending.length === 0 ? 0 : Math.max(0, Date.now() - oldestTimestamp),
    };
  }

  /**
   * Milliseconds since the oldest pending/submitting item was enqueued.
   * Consumers can use this to surface a "queued writes are aging" signal and,
   * for example, warn a user that offline writes have not been delivered.
   */
  getOldestPendingAgeMs(): number {
    return this.getState().oldestPendingAgeMs;
  }

  /**
   * Enqueue an operation for later submission.
   *
   * @param operation - Name of the operation (e.g. "submit_invoice").
   * @param params - Parameters that will be replayed after reconnect.
   * @param opts - Optional idempotency control.
   *
   * Idempotency: when `opts.idempotencyKey` is given, or derivable from
   * `(operation, params)`, enqueueing a duplicate while an equivalent item is
   * already pending or submitting returns the existing item instead of adding a
   * new one. This guarantees a flaky reconnect can never double-submit a write.
   */
  enqueue(
    operation: string,
    params: unknown,
    opts: { idempotencyKey?: string } = {}
  ): OfflineQueueItem {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Queue is full (max ${this.config.maxQueueSize} items)`);
    }

    const dedupKey = opts.idempotencyKey ?? deriveDedupKey(operation, params);

    const existing = this.queue.find(
      (i) => i.dedupKey === dedupKey && (i.status === 'pending' || i.status === 'submitting')
    );
    if (existing) {
      logger.debug(`Deduped enqueue of ${operation} — reusing item ${existing.id}`);
      return existing;
    }

    const item: OfflineQueueItem = {
      id: this.generateId(),
      operation,
      params,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: this.config.maxRetries,
      status: 'pending',
      dedupKey,
      sequence: this.nextSequence(),
    };

    this.queue.push(item);
    this.saveQueue();
    this.notifyListeners();

    logger.debug(`Enqueued operation: ${operation} (id: ${item.id}, seq: ${item.sequence})`);
    return item;
  }

  /**
   * Manually trigger processing of the queue.
   */
  async processQueue(): Promise<void> {
    if (!this.isOnline || !this.submitCallback) {
      return;
    }

    const pending = this.queue.filter((i) => i.status === 'pending');

    for (const item of pending) {
      if (!this.isOnline) break;

      item.status = 'submitting';
      this.notifyListeners();

      try {
        const success = await this.submitCallback(item);
        if (success) {
          item.status = 'completed';
          logger.debug(`Successfully submitted: ${item.operation} (id: ${item.id})`);
        } else {
          this.handleFailedSubmission(item, 'Submission returned false');
        }
      } catch (error) {
        this.handleFailedSubmission(item, String(error));
      }

      this.saveQueue();
      this.notifyListeners();
    }

    // Clean up completed items
    this.queue = this.queue.filter((i) => i.status !== 'completed');
    this.saveQueue();
    this.notifyListeners();
  }

  /**
   * Retry a specific failed item.
   */
  async retryItem(id: string): Promise<void> {
    const item = this.queue.find((i) => i.id === id && i.status === 'failed');
    if (!item) {
      throw new Error(`Item ${id} not found or not in failed state`);
    }

    item.status = 'pending';
    item.retries = 0;
    item.error = undefined;
    this.saveQueue();
    this.notifyListeners();

    await this.processQueue();
  }

  /**
   * Remove an item from the queue.
   */
  removeItem(id: string): boolean {
    const index = this.queue.findIndex((i) => i.id === id);
    if (index === -1) return false;

    this.queue.splice(index, 1);
    this.saveQueue();
    this.notifyListeners();
    return true;
  }

  /**
   * Clear all items from the queue.
   */
  clearQueue(): void {
    this.queue = [];
    this.saveQueue();
    this.notifyListeners();
  }

  /**
   * Get all items in the queue.
   */
  getQueue(): ReadonlyArray<OfflineQueueItem> {
    return [...this.queue];
  }

  /**
   * Check if the SDK is currently online.
   */
  getIsOnline(): boolean {
    return this.isOnline;
  }

  /**
   * Manually set online status.
   */
  setOnline(online: boolean): void {
    if (this.isOnline === online) return;

    this.isOnline = online;
    this.notifyListeners();

    if (online) {
      logger.info('SDK is back online, processing queue...');
      this.processQueue();
    } else {
      logger.info('SDK is offline, operations will be queued');
    }
  }

  /**
   * Export queue data for persistence or debugging.
   */
  exportData(): { queue: ReadonlyArray<OfflineQueueItem>; state: OfflineState } {
    return {
      queue: this.getQueue(),
      state: this.getState(),
    };
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.listeners.clear();
  }

  // ── Private Methods ───────────────────────────────────────────────────────

  private handleOnline = (): void => {
    this.setOnline(true);
  };

  private handleOffline = (): void => {
    this.setOnline(false);
  };

  private setupEventListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  private handleFailedSubmission(item: OfflineQueueItem, error: string): void {
    item.retries++;
    item.error = error;

    if (item.retries >= item.maxRetries) {
      item.status = 'failed';
      logger.error(`Failed to submit ${item.operation} after ${item.retries} retries: ${error}`);
    } else {
      item.status = 'pending';
      logger.warn(`Retry ${item.retries}/${item.maxRetries} for ${item.operation}: ${error}`);

      // Schedule retry
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.processQueue();
      }, this.config.retryDelayMs);
    }
  }

  private generateId(): string {
    return `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private nextSequence(): number {
    return this.queue.reduce((max, i) => Math.max(max, i.sequence ?? 0), 0) + 1;
  }

  private loadQueue(): void {
    try {
      const stored = this.config.storage.getItem(this.config.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as OfflineQueueItem[];
        this.queue = parsed.map((i) => ({
          ...i,
          sequence: typeof i.sequence === 'number' ? i.sequence : 0,
          dedupKey: typeof i.dedupKey === 'string' ? i.dedupKey : undefined,
        }));
        logger.debug(`Loaded ${this.queue.length} items from storage`);
      }
    } catch (error) {
      logger.error(`Failed to load queue from storage: ${error}`);
      this.queue = [];
    }
  }

  private saveQueue(): void {
    try {
      this.config.storage.setItem(this.config.storageKey, JSON.stringify(this.queue));
    } catch (error) {
      logger.error(`Failed to save queue to storage: ${error}`);
    }
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        logger.error(`Error in state change listener: ${error}`);
      }
    }
  }
}

/**
 * Offline-first data synchronization for browser clients.
 *
 * The module deliberately uses the platform IndexedDB API instead of importing a
 * browser-only package so the SDK remains usable in SSR and non-browser runtimes.
 * When IndexedDB is unavailable, data is retained in memory for the lifetime of
 * the page.
 */

export type CachedDataKind = "live" | "static";

export type OfflineOperation = "submit_invoice" | "fund_invoice" | "mark_paid";

export interface CacheRecord<T = unknown> {
  key: string;
  value: T;
  kind: CachedDataKind;
  storedAt: number;
  expiresAt: number;
}

export interface OfflineTransaction {
  id: string;
  operation: OfflineOperation;
  params: unknown;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: "pending" | "submitting" | "failed" | "conflict" | "completed";
  error?: string;
  conflict?: OfflineConflict;
}

export interface OfflineConflict {
  transactionId: string;
  operation: OfflineOperation;
  localParams: unknown;
  remoteState: unknown;
  detectedAt: number;
}

export interface OfflineSyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingTransactions: number;
  failedTransactions: number;
  conflictTransactions: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

export interface OfflineSyncHandlers {
  submit_invoice?: (params: unknown) => Promise<unknown>;
  fund_invoice?: (params: unknown) => Promise<unknown>;
  mark_paid?: (params: unknown) => Promise<unknown>;
  /** Return the current remote invoice state for conflict detection. */
  getInvoiceState?: (params: unknown) => Promise<unknown>;
  /** Return false when local and remote states cannot be safely merged. */
  canApply?: (transaction: OfflineTransaction, remoteState: unknown) => boolean;
}

export interface OfflineSyncOptions {
  dbName?: string;
  heartbeatUrl?: string;
  heartbeatIntervalMs?: number;
  liveTtlMs?: number;
  staticTtlMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  now?: () => number;
  fetcher?: typeof fetch;
}

export interface BackgroundSyncRegistration {
  register(tag: string): Promise<void>;
}

const DEFAULTS = {
  dbName: "iln-offline",
  heartbeatIntervalMs: 30_000,
  liveTtlMs: 5 * 60_000,
  staticTtlMs: 60 * 60_000,
  maxRetries: 5,
  retryBaseMs: 2_000,
};

const CACHE_STORE = "cache";
const QUEUE_STORE = "transactions";

function hasIndexedDb(): boolean {
  return typeof globalThis !== "undefined" && "indexedDB" in globalThis;
}

function currentOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function createId(): string {
  const cryptoObject = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class MemoryStore {
  readonly cache = new Map<string, CacheRecord>();
  readonly queue = new Map<string, OfflineTransaction>();
}

export class OfflineDataStore {
  private readonly memory = new MemoryStore();
  private readonly dbName: string;
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(dbName = DEFAULTS.dbName) {
    this.dbName = dbName;
  }

  async get<T>(key: string, now = Date.now()): Promise<T | null> {
    const record = await this.readCache(key);
    if (!record || record.expiresAt <= now) {
      if (record) await this.deleteCache(key);
      return null;
    }
    return record.value as T;
  }

  async put<T>(key: string, value: T, kind: CachedDataKind, ttlMs: number, now = Date.now()): Promise<void> {
    const record: CacheRecord<T> = {
      key,
      value,
      kind,
      storedAt: now,
      expiresAt: now + ttlMs,
    };
    const db = await this.database();
    if (!db) {
      this.memory.cache.set(key, record);
      return;
    }
    await this.request<void>(db, CACHE_STORE, "readwrite", (store) => store.put(record));
  }

  async remove(key: string): Promise<void> {
    await this.deleteCache(key);
  }

  async enqueue(transaction: OfflineTransaction): Promise<void> {
    const db = await this.database();
    if (!db) {
      this.memory.queue.set(transaction.id, transaction);
      return;
    }
    await this.request<void>(db, QUEUE_STORE, "readwrite", (store) => store.put(transaction));
  }

  async listTransactions(): Promise<OfflineTransaction[]> {
    const db = await this.database();
    if (!db) return [...this.memory.queue.values()];
    return this.request<OfflineTransaction[]>(db, QUEUE_STORE, "readonly", (store) => store.getAll());
  }

  async removeTransaction(id: string): Promise<void> {
    const db = await this.database();
    if (!db) {
      this.memory.queue.delete(id);
      return;
    }
    await this.request<void>(db, QUEUE_STORE, "readwrite", (store) => store.delete(id));
  }

  private async readCache(key: string): Promise<CacheRecord | null> {
    const db = await this.database();
    if (!db) return this.memory.cache.get(key) ?? null;
    return this.request<CacheRecord | undefined>(db, CACHE_STORE, "readonly", (store) => store.get(key));
  }

  private async deleteCache(key: string): Promise<void> {
    const db = await this.database();
    if (!db) {
      this.memory.cache.delete(key);
      return;
    }
    await this.request<void>(db, CACHE_STORE, "readwrite", (store) => store.delete(key));
  }

  private async database(): Promise<IDBDatabase | null> {
    if (!hasIndexedDb()) return null;
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        const request = indexedDB.open(this.dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: "key" });
          if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });
    }
    return this.dbPromise;
  }

  private request<T>(
    db: IDBDatabase,
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
}

export class OfflineSyncEngine {
  private readonly store: OfflineDataStore;
  private readonly options: Required<Pick<OfflineSyncOptions, "heartbeatIntervalMs" | "liveTtlMs" | "staticTtlMs" | "maxRetries" | "retryBaseMs">> & OfflineSyncOptions;
  private readonly handlers: OfflineSyncHandlers;
  private readonly listeners = new Set<(state: OfflineSyncState) => void>();
  private online = currentOnline();
  private syncing = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;

  constructor(handlers: OfflineSyncHandlers, options: OfflineSyncOptions = {}, store = new OfflineDataStore(options.dbName)) {
    this.handlers = handlers;
    this.options = { ...DEFAULTS, ...options };
    this.store = store;
  }

  start(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
    this.heartbeatTimer = setInterval(() => void this.checkConnectivity(), this.options.heartbeatIntervalMs);
    void this.checkConnectivity();
  }

  stop(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  getState(): OfflineSyncState {
    return { isOnline: this.online, isSyncing: this.syncing, pendingTransactions: 0, failedTransactions: 0, conflictTransactions: 0, lastSyncedAt: this.lastSyncedAt, lastError: this.lastError };
  }

  async state(): Promise<OfflineSyncState> {
    const transactions = await this.store.listTransactions();
    return { ...this.getState(), pendingTransactions: transactions.filter((item) => item.status === "pending" || item.status === "submitting").length, failedTransactions: transactions.filter((item) => item.status === "failed").length, conflictTransactions: transactions.filter((item) => item.status === "conflict").length };
  }

  subscribe(listener: (state: OfflineSyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async cache<T>(key: string, value: T, kind: CachedDataKind = "live"): Promise<void> {
    const ttl = kind === "static" ? this.options.staticTtlMs : this.options.liveTtlMs;
    await this.store.put(key, value, kind, ttl, this.now());
  }

  getCached<T>(key: string): Promise<T | null> {
    return this.store.get<T>(key, this.now());
  }

  async enqueue(operation: OfflineOperation, params: unknown): Promise<OfflineTransaction> {
    const now = this.now();
    const transaction: OfflineTransaction = { id: createId(), operation, params, createdAt: now, updatedAt: now, attempts: 0, nextAttemptAt: now, status: "pending" };
    await this.store.enqueue(transaction);
    await this.notify();
    if (this.online) void this.sync();
    return transaction;
  }

  async sync(): Promise<void> {
    if (!this.online || this.syncing) return;
    this.syncing = true;
    await this.notify();
    try {
      const items = (await this.store.listTransactions()).filter((item) => item.status === "pending" || item.status === "failed").sort((a, b) => a.createdAt - b.createdAt);
      for (const item of items) {
        if (item.nextAttemptAt > this.now()) continue;
        await this.submit(item);
      }
      this.lastSyncedAt = this.now();
      this.lastError = null;
    } finally {
      this.syncing = false;
      await this.notify();
    }
  }

  private async submit(item: OfflineTransaction): Promise<void> {
    const handler = this.handlers[item.operation];
    if (!handler) return this.fail(item, `No handler registered for ${item.operation}`);
    const submitting = { ...item, status: "submitting" as const, updatedAt: this.now() };
    await this.store.enqueue(submitting);
    try {
      if (this.handlers.getInvoiceState) {
        const remote = await this.handlers.getInvoiceState(item.params);
        if (remote !== null && this.handlers.canApply && !this.handlers.canApply(item, remote)) {
          await this.store.enqueue({ ...submitting, status: "conflict", conflict: { transactionId: item.id, operation: item.operation, localParams: item.params, remoteState: remote, detectedAt: this.now() }, updatedAt: this.now() });
          return;
        }
      }
      await handler(item.params);
      await this.store.removeTransaction(item.id);
    } catch (error) {
      await this.fail(item, error instanceof Error ? error.message : String(error));
    }
  }

  private async fail(item: OfflineTransaction, error: string): Promise<void> {
    const attempts = item.attempts + 1;
    const exhausted = attempts >= this.options.maxRetries;
    await this.store.enqueue({ ...item, status: exhausted ? "failed" : "pending", attempts, updatedAt: this.now(), nextAttemptAt: this.now() + this.options.retryBaseMs * 2 ** Math.min(attempts - 1, 10), error });
    this.lastError = error;
  }

  private async checkConnectivity(): Promise<void> {
    let reachable = currentOnline();
    if (reachable && this.options.heartbeatUrl && this.options.fetcher) {
      try {
        const response = await this.options.fetcher(this.options.heartbeatUrl, { method: "HEAD", cache: "no-store" });
        reachable = response.ok;
      } catch {
        reachable = false;
      }
    }
    const changed = reachable !== this.online;
    this.online = reachable;
    await this.notify();
    if (changed && reachable) await this.sync();
  }

  private readonly handleOnline = (): void => {
    this.online = true;
    void this.sync();
  };

  private readonly handleOffline = (): void => {
    this.online = false;
    void this.notify();
  };

  private async notify(): Promise<void> {
    const current = await this.state();
    for (const listener of this.listeners) listener(current);
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
}

export async function registerOfflineBackgroundSync(registration: BackgroundSyncRegistration): Promise<void> {
  try {
    await registration.register("iln-offline-transactions");
  } catch {
    // Background Sync is optional; foreground synchronization remains active.
  }
}

export async function registerPeriodicDataSync(registration: BackgroundSyncRegistration): Promise<void> {
  try {
    await registration.register("iln-periodic-data-refresh");
  } catch {
    // Periodic Background Sync is optional and unsupported in some browsers.
  }
}

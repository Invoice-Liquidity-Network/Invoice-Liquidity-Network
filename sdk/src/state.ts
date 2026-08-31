/**
 * Reactive state management for the ILN SDK.
 *
 * Provides a typed reactive store with subscriptions, optional persistence
 * (localStorage or in-memory fallback), cross-tab synchronization, and
 * a debug log for observing state transitions.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type Listener<T> = (state: T, prev: T) => void;
export type Unsubscribe = () => void;

export interface StateDebugEntry<T> {
  timestamp: string;
  prev: T;
  next: T;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- T is a phantom param kept for API symmetry with StateStore<T>
export interface StateStoreOptions<T> {
  /** Storage key for persistence (required when `persist: true`). */
  key?: string;
  /** Persist state to localStorage / in-memory fallback. */
  persist?: boolean;
  /** Enable cross-tab synchronization via `storage` events (browser only). */
  sync?: boolean;
  /** Keep the last N state transitions in the debug log (default: 20). */
  debugHistorySize?: number;
}

export interface StateStore<T> {
  /** Return the current state snapshot. */
  getState(): T;
  /** Replace the state and notify all subscribers. */
  setState(next: T | ((prev: T) => T)): void;
  /** Patch a partial update into the current state (only for object states). */
  patch(partial: Partial<T>): void;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: Listener<T>): Unsubscribe;
  /** Destroy the store — clears subscriptions, removes sync listener. */
  destroy(): void;
  /** Return the debug history of state transitions. */
  debugHistory(): Array<StateDebugEntry<T>>;
  /** Clear the debug history. */
  clearDebugHistory(): void;
}

// ── Storage adapter ────────────────────────────────────────────────────────

interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveStorage(): StorageAdapter {
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  // In-memory fallback for Node.js / environments without localStorage
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => {
      mem.set(k, v);
    },
    removeItem: (k) => {
      mem.delete(k);
    },
  };
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a reactive state store.
 *
 * @param initialState - The initial state value.
 * @param options - Store configuration.
 *
 * @example
 * ```ts
 * interface InvoiceState {
 *   invoices: Invoice[];
 *   loading: boolean;
 * }
 *
 * const store = createStateStore<InvoiceState>(
 *   { invoices: [], loading: false },
 *   { key: "iln:invoices", persist: true, sync: true },
 * );
 *
 * const unsub = store.subscribe((state, prev) => {
 *   console.log("invoices changed", state.invoices);
 * });
 *
 * store.patch({ loading: true });
 * // ...
 * unsub();
 * ```
 */
export function createStateStore<T>(
  initialState: T,
  options: StateStoreOptions<T> = {}
): StateStore<T> {
  const { key, persist = false, sync = false, debugHistorySize = 20 } = options;

  const storage = persist ? resolveStorage() : null;
  const listeners = new Set<Listener<T>>();
  const history: Array<StateDebugEntry<T>> = [];

  function load(): T {
    if (!storage || !key) return initialState;
    try {
      const raw = storage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initialState;
    } catch {
      return initialState;
    }
  }

  function save(state: T): void {
    if (storage && key) {
      try {
        storage.setItem(key, JSON.stringify(state));
      } catch {
        // Quota exceeded or serialization error — silently skip persistence
      }
    }
  }

  let current: T = load();

  function notify(next: T, prev: T): void {
    const entry: StateDebugEntry<T> = {
      timestamp: new Date().toISOString(),
      prev,
      next,
    };
    history.push(entry);
    if (history.length > debugHistorySize) history.shift();

    for (const listener of listeners) {
      try {
        listener(next, prev);
      } catch {
        // Listener errors must not block other listeners
      }
    }
  }

  // Cross-tab synchronization (browser `storage` event)
  let syncHandler: ((e: StorageEvent) => void) | null = null;
  if (sync && key && typeof window !== 'undefined') {
    syncHandler = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      try {
        const remote = JSON.parse(e.newValue) as T;
        const prev = current;
        current = remote;
        notify(current, prev);
      } catch {
        // Ignore malformed payloads from other tabs
      }
    };
    window.addEventListener('storage', syncHandler);
  }

  const store: StateStore<T> = {
    getState(): T {
      return current;
    },

    setState(next: T | ((prev: T) => T)): void {
      const prev = current;
      current = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      save(current);
      notify(current, prev);
    },

    patch(partial: Partial<T>): void {
      if (typeof current !== 'object' || current === null) {
        throw new TypeError('patch() can only be used with object states');
      }
      store.setState({ ...current, ...partial });
    },

    subscribe(listener: Listener<T>): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    destroy(): void {
      listeners.clear();
      if (syncHandler && typeof window !== 'undefined') {
        window.removeEventListener('storage', syncHandler);
        syncHandler = null;
      }
    },

    debugHistory(): Array<StateDebugEntry<T>> {
      return [...history];
    },

    clearDebugHistory(): void {
      history.length = 0;
    },
  };

  return store;
}

// ── Derived / computed values ──────────────────────────────────────────────

/**
 * Create a derived store that re-computes whenever the source store changes.
 *
 * @example
 * ```ts
 * const invoiceCount = derived(store, (s) => s.invoices.length);
 * console.log(invoiceCount.getState()); // number
 * ```
 */
export function derived<T, U>(
  source: StateStore<T>,
  selector: (state: T) => U
): Omit<StateStore<U>, 'setState' | 'patch'> {
  let current = selector(source.getState());
  const listeners = new Set<Listener<U>>();

  const unsub = source.subscribe((next) => {
    const prev = current;
    const computed = selector(next);
    if (computed !== prev) {
      current = computed;
      for (const l of listeners) {
        try {
          l(current, prev);
        } catch {
          /* ignore */
        }
      }
    }
  });

  return {
    getState: () => current,
    subscribe(listener: Listener<U>): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      unsub();
      listeners.clear();
    },
    debugHistory: () => [],
    clearDebugHistory: () => {},
  };
}

// ── Pre-built ILN state shapes ─────────────────────────────────────────────

export interface ILNConnectionState {
  connected: boolean;
  network: string;
  contractId: string;
  lastSyncAt: string | null;
  error: string | null;
}

export interface ILNInvoiceListState {
  invoices: Array<{
    id: bigint;
    status: string;
    amount: bigint;
    payer: string;
    freelancer: string;
  }>;
  loading: boolean;
  error: string | null;
  lastFetchedAt: string | null;
}

export const DEFAULT_CONNECTION_STATE: ILNConnectionState = {
  connected: false,
  network: 'testnet',
  contractId: '',
  lastSyncAt: null,
  error: null,
};

export const DEFAULT_INVOICE_LIST_STATE: ILNInvoiceListState = {
  invoices: [],
  loading: false,
  error: null,
  lastFetchedAt: null,
};

/**
 * Create a pre-typed connection state store.
 */
export function createConnectionStore(
  initial?: Partial<ILNConnectionState>,
  options?: StateStoreOptions<ILNConnectionState>
): StateStore<ILNConnectionState> {
  return createStateStore<ILNConnectionState>(
    { ...DEFAULT_CONNECTION_STATE, ...initial },
    { key: 'iln:connection', ...options }
  );
}

/**
 * Create a pre-typed invoice list state store.
 */
export function createInvoiceListStore(
  initial?: Partial<ILNInvoiceListState>,
  options?: StateStoreOptions<ILNInvoiceListState>
): StateStore<ILNInvoiceListState> {
  return createStateStore<ILNInvoiceListState>(
    { ...DEFAULT_INVOICE_LIST_STATE, ...initial },
    { key: 'iln:invoices', ...options }
  );
}

/**
 * Opt-in request batching and deduplication layer for SDK read operations.
 * Coalesces near-simultaneous identical or batchable read requests to reduce
 * RPC / indexer load and latency.
 */

export interface RequestBatchingOptions {
  /** Whether request batching and deduplication is enabled. Defaults to false. */
  enabled?: boolean;
  /** Coalescing window in milliseconds to group near-simultaneous calls. Defaults to 10ms. */
  windowMs?: number;
  /** Whether to deduplicate in-flight identical requests. Defaults to true. */
  deduplicate?: boolean;
  /** Maximum number of operations per coalesced batch window. Defaults to 50. */
  maxBatchSize?: number;
}

export interface BatchingMetrics {
  totalRequests: number;
  deduplicatedRequests: number;
  batchesExecuted: number;
  rpcCallsSaved: number;
  reductionPercentage: number;
}

export class RequestBatcher {
  private readonly options: Required<RequestBatchingOptions>;
  private readonly pendingInflight = new Map<string, Promise<unknown>>();
  private readonly batchQueue = new Map<
    string,
    {
      key: string;
      fn: () => Promise<unknown>;
      resolvers: Array<{ resolve: (val: any) => void; reject: (err: any) => void }>;
    }
  >();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private totalRequests = 0;
  private deduplicatedRequests = 0;
  private batchesExecuted = 0;

  constructor(options?: RequestBatchingOptions | boolean) {
    if (typeof options === 'boolean') {
      this.options = {
        enabled: options,
        windowMs: 10,
        deduplicate: true,
        maxBatchSize: 50,
      };
    } else {
      this.options = {
        enabled: options?.enabled ?? false,
        windowMs: options?.windowMs ?? 10,
        deduplicate: options?.deduplicate ?? true,
        maxBatchSize: options?.maxBatchSize ?? 50,
      };
    }
  }

  public get isEnabled(): boolean {
    return this.options.enabled;
  }

  /**
   * Execute or schedule a read operation with deduplication and batching.
   */
  public async execute<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (!this.options.enabled) {
      return fetcher();
    }

    // In-flight deduplication
    if (this.options.deduplicate && this.pendingInflight.has(key)) {
      this.deduplicatedRequests++;
      return this.pendingInflight.get(key) as Promise<T>;
    }

    // Queue for coalesced batch window if windowMs > 0
    if (this.options.windowMs > 0) {
      return this.enqueueBatch<T>(key, fetcher);
    }

    // Direct execution with in-flight tracking
    const promise = fetcher().finally(() => {
      this.pendingInflight.delete(key);
    });

    if (this.options.deduplicate) {
      this.pendingInflight.set(key, promise);
    }

    return promise;
  }

  private enqueueBatch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const existing = this.batchQueue.get(key);

      if (existing) {
        this.deduplicatedRequests++;
        existing.resolvers.push({ resolve, reject });
      } else {
        this.batchQueue.set(key, {
          key,
          fn: fetcher,
          resolvers: [{ resolve, reject }],
        });
      }

      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushBatchQueue(), this.options.windowMs);
      }
    });
  }

  private async flushBatchQueue(): Promise<void> {
    this.batchTimer = null;
    const entries = Array.from(this.batchQueue.values());
    this.batchQueue.clear();

    if (entries.length === 0) return;

    this.batchesExecuted++;

    // Process each queued unique read
    await Promise.all(
      entries.map(async (entry) => {
        const promise = (async () => {
          try {
            const result = await entry.fn();
            for (const res of entry.resolvers) {
              res.resolve(result);
            }
            return result;
          } catch (error) {
            for (const res of entry.resolvers) {
              res.reject(error);
            }
            throw error;
          }
        })();

        if (this.options.deduplicate) {
          this.pendingInflight.set(entry.key, promise);
          promise.finally(() => this.pendingInflight.delete(entry.key));
        }
      })
    );
  }

  public getMetrics(): BatchingMetrics {
    const saved = this.deduplicatedRequests;
    const reductionPct =
      this.totalRequests > 0 ? Math.round((saved / this.totalRequests) * 10000) / 100 : 0;

    return {
      totalRequests: this.totalRequests,
      deduplicatedRequests: this.deduplicatedRequests,
      batchesExecuted: this.batchesExecuted,
      rpcCallsSaved: saved,
      reductionPercentage: reductionPct,
    };
  }

  public resetMetrics(): void {
    this.totalRequests = 0;
    this.deduplicatedRequests = 0;
    this.batchesExecuted = 0;
  }
}

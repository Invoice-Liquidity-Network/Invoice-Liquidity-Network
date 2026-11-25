export interface BucketState {
  timestamps: number[];
  windowMs: number;
  limit: number;
}

export interface RateLimiterSnapshot {
  userBuckets: Record<string, BucketState>;
  recipientBuckets: Record<string, BucketState>;
  exportedAt: number;
}

type RateLimitBaseConfig = {
  /** Maximum requests per window per user. */
  perUserLimit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
};

export type RateLimitConfig = RateLimitBaseConfig &
  (
    | { perRecipientLimit: number; perChannelLimit?: never }
    | {
        /** @deprecated Use perRecipientLimit. */
        perChannelLimit: number;
        perRecipientLimit?: never;
      }
  );

export interface RateLimitResult {
  allowed: boolean;
  /** Configured limit for this bucket. */
  limit: number;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Unix timestamp (seconds) when the window resets. */
  resetAt: number;
}

function checkBucket(bucket: BucketState, now: number): RateLimitResult {
  // Evict timestamps outside the current window.
  const windowStart = now - bucket.windowMs;
  bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

  const resetAt =
    bucket.timestamps.length > 0
      ? Math.ceil((bucket.timestamps[0] + bucket.windowMs) / 1000)
      : Math.ceil((now + bucket.windowMs) / 1000);

  if (bucket.timestamps.length >= bucket.limit) {
    return {
      allowed: false,
      limit: bucket.limit,
      remaining: 0,
      resetAt,
    };
  }

  bucket.timestamps.push(now);
  return {
    allowed: true,
    limit: bucket.limit,
    remaining: bucket.limit - bucket.timestamps.length,
    resetAt,
  };
}

export class RateLimiter {
  private userBuckets = new Map<string, BucketState>();
  private recipientBuckets = new Map<string, BucketState>();
  private config: RateLimitBaseConfig & { perRecipientLimit: number };

  constructor(config: RateLimitConfig) {
    this.config = {
      perUserLimit: config.perUserLimit,
      perRecipientLimit: config.perRecipientLimit ?? config.perChannelLimit ?? 200,
      windowMs: config.windowMs,
    };
  }

  check(userId: string, channel: string, recipientId = userId): RateLimitResult {
    const now = Date.now();

    // Per-user check.
    if (!this.userBuckets.has(userId)) {
      this.userBuckets.set(userId, {
        timestamps: [],
        windowMs: this.config.windowMs,
        limit: this.config.perUserLimit,
      });
    }
    const userResult = checkBucket(this.userBuckets.get(userId)!, now);
    if (!userResult.allowed) return userResult;

    // Per-recipient channel check: one subscriber cannot consume another's quota.
    const normalizedRecipient =
      channel === "email" ? recipientId.trim().toLowerCase() : recipientId.trim();
    const recipientKey = JSON.stringify([channel, normalizedRecipient]);
    if (!this.recipientBuckets.has(recipientKey)) {
      this.recipientBuckets.set(recipientKey, {
        timestamps: [],
        windowMs: this.config.windowMs,
        limit: this.config.perRecipientLimit,
      });
    }
    const recipientResult = checkBucket(this.recipientBuckets.get(recipientKey)!, now);
    if (!recipientResult.allowed) {
      // Roll back the user-bucket timestamp we just inserted.
      const ub = this.userBuckets.get(userId)!;
      ub.timestamps.pop();
      return recipientResult;
    }

    // Return the more-restrictive remaining of the user and recipient buckets.
    return {
      allowed: true,
      limit: Math.min(userResult.limit, recipientResult.limit),
      remaining: Math.min(userResult.remaining, recipientResult.remaining),
      resetAt: Math.max(userResult.resetAt, recipientResult.resetAt),
    };
  }

  /**
   * Export the current rate limiter state for persistence across restarts
   * or replication across distributed worker instances (#1465).
   */
  exportState(now: number = Date.now()): RateLimiterSnapshot {
    const userBuckets: Record<string, BucketState> = {};
    for (const [key, bucket] of this.userBuckets.entries()) {
      const windowStart = now - bucket.windowMs;
      const validTimestamps = bucket.timestamps.filter((t) => t > windowStart);
      if (validTimestamps.length > 0) {
        userBuckets[key] = {
          timestamps: [...validTimestamps],
          windowMs: bucket.windowMs,
          limit: bucket.limit,
        };
      }
    }

    const recipientBuckets: Record<string, BucketState> = {};
    for (const [key, bucket] of this.recipientBuckets.entries()) {
      const windowStart = now - bucket.windowMs;
      const validTimestamps = bucket.timestamps.filter((t) => t > windowStart);
      if (validTimestamps.length > 0) {
        recipientBuckets[key] = {
          timestamps: [...validTimestamps],
          windowMs: bucket.windowMs,
          limit: bucket.limit,
        };
      }
    }

    return {
      userBuckets,
      recipientBuckets,
      exportedAt: now,
    };
  }

  /**
   * Import rate limiter state from persistent storage or a peer worker,
   * pruning any timestamps that have expired relative to current time (#1465).
   */
  importState(snapshot: RateLimiterSnapshot, now: number = Date.now()): void {
    if (!snapshot) return;

    if (snapshot.userBuckets) {
      for (const [key, bucket] of Object.entries(snapshot.userBuckets)) {
        const windowStart = now - bucket.windowMs;
        const activeTimestamps = (bucket.timestamps || []).filter((t) => t > windowStart);
        if (activeTimestamps.length > 0) {
          const existing = this.userBuckets.get(key);
          if (existing) {
            existing.timestamps = [...existing.timestamps, ...activeTimestamps]
              .filter((t) => t > windowStart)
              .sort((a, b) => a - b);
          } else {
            this.userBuckets.set(key, {
              timestamps: activeTimestamps.sort((a, b) => a - b),
              windowMs: bucket.windowMs || this.config.windowMs,
              limit: bucket.limit || this.config.perUserLimit,
            });
          }
        }
      }
    }

    if (snapshot.recipientBuckets) {
      for (const [key, bucket] of Object.entries(snapshot.recipientBuckets)) {
        const windowStart = now - bucket.windowMs;
        const activeTimestamps = (bucket.timestamps || []).filter((t) => t > windowStart);
        if (activeTimestamps.length > 0) {
          const existing = this.recipientBuckets.get(key);
          if (existing) {
            existing.timestamps = [...existing.timestamps, ...activeTimestamps]
              .filter((t) => t > windowStart)
              .sort((a, b) => a - b);
          } else {
            this.recipientBuckets.set(key, {
              timestamps: activeTimestamps.sort((a, b) => a - b),
              windowMs: bucket.windowMs || this.config.windowMs,
              limit: bucket.limit || this.config.perRecipientLimit,
            });
          }
        }
      }
    }
  }

  /** Remove the aggregate user bucket; recipient quotas expire with their window. */
  reset(userId?: string): void {
    if (userId) {
      this.userBuckets.delete(userId);
    } else {
      this.userBuckets.clear();
      this.recipientBuckets.clear();
    }
  }
}

export interface RateLimitConfig {
  /** Maximum requests per window per user. */
  perUserLimit: number;
  /** Maximum requests per window per channel. */
  perChannelLimit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Configured limit for this bucket. */
  limit: number;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Unix timestamp (seconds) when the window resets. */
  resetAt: number;
}

interface Bucket {
  timestamps: number[];
  windowMs: number;
  limit: number;
}

function checkBucket(bucket: Bucket, now: number): RateLimitResult {
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
  private userBuckets = new Map<string, Bucket>();
  private channelBuckets = new Map<string, Bucket>();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  check(userId: string, channel: string): RateLimitResult {
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

    // Per-recipient check (user + channel combined).
    const recipientKey = `${userId}:${channel}`;
    if (!this.channelBuckets.has(recipientKey)) {
      this.channelBuckets.set(recipientKey, {
        timestamps: [],
        windowMs: this.config.windowMs,
        limit: this.config.perChannelLimit,
      });
    }
    const channelResult = checkBucket(this.channelBuckets.get(recipientKey)!, now);
    if (!channelResult.allowed) {
      // Roll back the user-bucket timestamp we just inserted.
      const ub = this.userBuckets.get(userId)!;
      ub.timestamps.pop();
      return channelResult;
    }

    // Return the more-restrictive remaining of the two buckets.
    return {
      allowed: true,
      limit: Math.min(userResult.limit, channelResult.limit),
      remaining: Math.min(userResult.remaining, channelResult.remaining),
      resetAt: Math.max(userResult.resetAt, channelResult.resetAt),
    };
  }

  /** Remove all tracking data for a user (e.g. on unsubscribe). */
  reset(userId: string): void {
    this.userBuckets.delete(userId);
  }
}

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
  private recipientBuckets = new Map<string, Bucket>();
  private config: RateLimitBaseConfig & { perRecipientLimit: number };

  constructor(config: RateLimitConfig) {
    this.config = {
      perUserLimit: config.perUserLimit,
      perRecipientLimit: config.perRecipientLimit ?? config.perChannelLimit,
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
    // Per-recipient check (user + channel combined).
    const recipientKey = `${userId}:${channel}`;
    if (!this.channelBuckets.has(recipientKey)) {
      this.channelBuckets.set(recipientKey, {
        timestamps: [],
        windowMs: this.config.windowMs,
        limit: this.config.perRecipientLimit,
      });
    }
    const recipientResult = checkBucket(this.recipientBuckets.get(recipientKey)!, now);
    if (!recipientResult.allowed) {
    const channelResult = checkBucket(this.channelBuckets.get(recipientKey)!, now);
    if (!channelResult.allowed) {
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

  /** Remove the aggregate user bucket; recipient quotas expire with their window. */
  reset(userId: string): void {
    this.userBuckets.delete(userId);
  }
}

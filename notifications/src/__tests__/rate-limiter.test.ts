process.env.NOTIFICATIONS_RPC_URL = "http://localhost:8000";
process.env.NOTIFICATIONS_CONTRACT_ID = "GTESTCONTRACT";
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
process.env.RESEND_API_KEY = "test-api-key";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import Database from "better-sqlite3";
import { createApp } from "../api";
import { createDb, setDb } from "../db";
import { RateLimiter } from "../rate-limiter";

describe("RateLimiter unit", () => {
  it("allows requests within the limit", () => {
    const rl = new RateLimiter({ perUserLimit: 3, perChannelLimit: 10, windowMs: 60_000 });
    const r1 = rl.check("user1", "email");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = rl.check("user1", "email");
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
  });

  it("blocks when per-user limit is exceeded", () => {
    const rl = new RateLimiter({ perUserLimit: 2, perChannelLimit: 100, windowMs: 60_000 });
    rl.check("user1", "email");
    rl.check("user1", "email");
    const r = rl.check("user1", "email");
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("blocks when per-channel limit is exceeded", () => {
    const rl = new RateLimiter({ perUserLimit: 100, perChannelLimit: 2, windowMs: 60_000 });
    rl.check("user1", "webhook");
    rl.check("user2", "webhook");
    const r = rl.check("user3", "webhook");
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("tracks different users independently", () => {
    const rl = new RateLimiter({ perUserLimit: 2, perChannelLimit: 100, windowMs: 60_000 });
    rl.check("userA", "email");
    rl.check("userA", "email");
    const blocked = rl.check("userA", "email");
    expect(blocked.allowed).toBe(false);

    const other = rl.check("userB", "email");
    expect(other.allowed).toBe(true);
  });

  it("sets limit and resetAt in result", () => {
    const rl = new RateLimiter({ perUserLimit: 5, perChannelLimit: 10, windowMs: 60_000 });
    const r = rl.check("user1", "email");
    expect(r.limit).toBe(5);
    expect(typeof r.resetAt).toBe("number");
    expect(r.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("resets a user bucket", () => {
    const rl = new RateLimiter({ perUserLimit: 1, perChannelLimit: 100, windowMs: 60_000 });
    rl.check("user1", "email");
    const blocked = rl.check("user1", "email");
    expect(blocked.allowed).toBe(false);

    rl.reset("user1");
    const after = rl.check("user1", "email");
    expect(after.allowed).toBe(true);
  });
});

describe("RateLimiter boundary conditions", () => {
  it("allows exactly at the limit and blocks on the next request", () => {
    const rl = new RateLimiter({ perUserLimit: 5, perChannelLimit: 100, windowMs: 60_000 });

    for (let i = 0; i < 5; i++) {
      const r = rl.check("boundary-user", "email");
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(5 - i - 1);
    }

    const blocked = rl.check("boundary-user", "email");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("allows exactly at per-channel limit", () => {
    const rl = new RateLimiter({ perUserLimit: 100, perChannelLimit: 3, windowMs: 60_000 });

    rl.check("u1", "sms");
    rl.check("u2", "sms");
    rl.check("u3", "sms");

    const blocked = rl.check("u4", "sms");
    expect(blocked.allowed).toBe(false);
  });

  it("returns remaining as 0 when at exact boundary", () => {
    const rl = new RateLimiter({ perUserLimit: 1, perChannelLimit: 100, windowMs: 60_000 });
    const r = rl.check("single-user", "email");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("limit of 1 blocks second request", () => {
    const rl = new RateLimiter({ perUserLimit: 1, perChannelLimit: 100, windowMs: 60_000 });
    rl.check("user", "email");
    const r = rl.check("user", "email");
    expect(r.allowed).toBe(false);
  });

  it("limit of 0 blocks all requests", () => {
    const rl = new RateLimiter({ perUserLimit: 0, perChannelLimit: 100, windowMs: 60_000 });
    const r = rl.check("user", "email");
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });
});

describe("RateLimiter burst-then-idle-then-burst", () => {
  it("allows new burst after window expires", () => {
    vi.useFakeTimers();
    const windowMs = 1000;
    const rl = new RateLimiter({ perUserLimit: 2, perChannelLimit: 100, windowMs });

    const baseTime = 1000;
    vi.setSystemTime(baseTime);

    rl.check("burst-user", "email");
    rl.check("burst-user", "email");
    const blocked = rl.check("burst-user", "email");
    expect(blocked.allowed).toBe(false);

    vi.setSystemTime(baseTime + windowMs + 1);

    const allowed = rl.check("burst-user", "email");
    expect(allowed.allowed).toBe(true);
    expect(allowed.remaining).toBe(1);

    vi.useRealTimers();
  });

  it("new burst does not count old timestamps outside window", () => {
    vi.useFakeTimers();
    const windowMs = 500;
    const rl = new RateLimiter({ perUserLimit: 3, perChannelLimit: 100, windowMs });

    vi.setSystemTime(1000);
    rl.check("t", "email");
    rl.check("t", "email");

    vi.setSystemTime(1000 + windowMs + 1);

    const r = rl.check("t", "email");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);

    vi.useRealTimers();
  });

  it("partial window expiry allows partial refill", () => {
    vi.useFakeTimers();
    const windowMs = 1000;
    const rl = new RateLimiter({ perUserLimit: 3, perChannelLimit: 100, windowMs });

    vi.setSystemTime(1000);
    rl.check("p", "email");
    rl.check("p", "email");
    rl.check("p", "email");
    const blocked1 = rl.check("p", "email");
    expect(blocked1.allowed).toBe(false);

    vi.setSystemTime(1000 + 1);
    const r = rl.check("p", "email");
    expect(r.allowed).toBe(true);

    vi.useRealTimers();
  });
});

describe("RateLimiter time-mocking edge cases", () => {
  it("window boundary is exclusive (exactly at window start is outside)", () => {
    vi.useFakeTimers();
    const windowMs = 1000;
    const rl = new RateLimiter({ perUserLimit: 2, perChannelLimit: 100, windowMs });

    vi.setSystemTime(1000);
    rl.check("tb", "email");
    rl.check("tb", "email");

    // Exactly at base + windowMs should allow (1000 > 1000 is false, 
    // but timestamps are filtered with `> windowStart` so timestamp=1000 
    // with now=2000 → windowStart=1000 → 1000 > 1000 is false → expired)
    vi.setSystemTime(1000 + windowMs);
    const r = rl.check("tb", "email");
    expect(r.allowed).toBe(true);

    vi.useRealTimers();
  });

  it("checkBucket uses strict greater-than for window eviction", () => {
    vi.useFakeTimers();
    const windowMs = 1000;
    const rl = new RateLimiter({ perUserLimit: 10, perChannelLimit: 100, windowMs });

    vi.setSystemTime(5000);
    rl.check("evict", "email");

    // Exactly windowMs later: windowStart = 6000 - 1000 = 5000
    // Timestamp 5000 is NOT > 5000, so it gets evicted
    vi.setSystemTime(5000 + windowMs);
    const r = rl.check("evict", "email");
    expect(r.remaining).toBe(9);

    vi.useRealTimers();
  });

  it("multiple checks at the same timestamp do not accumulate if at limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    const rl = new RateLimiter({ perUserLimit: 1, perChannelLimit: 100, windowMs: 60_000 });

    rl.check("same-ts", "email");
    const r = rl.check("same-ts", "email");
    expect(r.allowed).toBe(false);

    vi.useRealTimers();
  });
});

describe("RateLimiter concurrent requests", () => {
  it("multiple users hitting per-channel limit simultaneously", () => {
    const rl = new RateLimiter({ perUserLimit: 10, perChannelLimit: 3, windowMs: 60_000 });

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(rl.check(`concurrent-user-${i}`, "webhook"));
    }

    const allowed = results.filter((r) => r.allowed);
    const blocked = results.filter((r) => !r.allowed);

    expect(allowed).toHaveLength(3);
    expect(blocked).toHaveLength(7);
  });

  it("per-user limit is independent of per-channel limit", () => {
    const rl = new RateLimiter({ perUserLimit: 1, perChannelLimit: 100, windowMs: 60_000 });

    rl.check("u1", "email");
    const blocked = rl.check("u1", "email");
    expect(blocked.allowed).toBe(false);

    // Different channel, same user — still blocked by per-user
    const blocked2 = rl.check("u1", "webhook");
    expect(blocked2.allowed).toBe(false);
  });

  it("channel limit roll-back restores user timestamp", () => {
    const rl = new RateLimiter({ perUserLimit: 10, perChannelLimit: 2, windowMs: 60_000 });

    rl.check("rollback-user", "sms");
    rl.check("other", "sms");

    // This will hit channel limit, causing rollback of rollback-user's timestamp
    const blocked = rl.check("rollback-user", "sms");
    expect(blocked.allowed).toBe(false);

    // rollback-user should be able to use 1 request now (since rolled back)
    // But wait: they already have 1 in user bucket from first check
    // After rollback, user bucket is back to 1, but the 2nd check that 
    // triggered channel limit rolled back, so user bucket should be 1
    // Actually the user had 1 before, check returns allowed=true + adds timestamp,
    // then channel blocks and pops the last timestamp, so user is back to 1
    const r = rl.check("rollback-user", "email");
    expect(r.allowed).toBe(true);
  });
});

describe("RateLimiter channel bucket isolation", () => {
  it("different channels have independent buckets", () => {
    const rl = new RateLimiter({ perUserLimit: 100, perChannelLimit: 1, windowMs: 60_000 });

    rl.check("user", "email");
    const blockedEmail = rl.check("user", "email");
    expect(blockedEmail.allowed).toBe(false);

    const allowedSms = rl.check("user", "sms");
    expect(allowedSms.allowed).toBe(true);
  });

  it("per-channel limit applies across users for same channel", () => {
    const rl = new RateLimiter({ perUserLimit: 100, perChannelLimit: 2, windowMs: 60_000 });

    rl.check("user1", "sms");
    rl.check("user2", "sms");
    const blocked = rl.check("user3", "sms");
    expect(blocked.allowed).toBe(false);
  });
});

describe("RateLimiter window resetAt calculation", () => {
  it("resetAt is based on the first timestamp in the bucket", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const rl = new RateLimiter({ perUserLimit: 5, perChannelLimit: 100, windowMs: 1000 });

    rl.check("ra", "email");
    vi.setSystemTime(2000);
    rl.check("ra", "email");

    const r = rl.check("ra", "email");
    // resetAt should be based on first timestamp: ceil((1000 + 1000) / 1000) = 2
    expect(r.resetAt).toBe(2);

    vi.useRealTimers();
  });

  it("returns the more-restrictive remaining of user and channel", () => {
    const rl = new RateLimiter({ perUserLimit: 2, perChannelLimit: 100, windowMs: 60_000 });
    rl.check("user1", "email");
    const r = rl.check("user1", "email");
    expect(r.remaining).toBe(0);
    expect(r.limit).toBe(2);
  });

  it("returns max of resetAt from user and channel", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const rl = new RateLimiter({ perUserLimit: 10, perChannelLimit: 10, windowMs: 2000 });

    rl.check("r", "email");
    const r = rl.check("r", "email");
    expect(r.resetAt).toBeGreaterThanOrEqual(Math.ceil((1000 + 2000) / 1000));

    vi.useRealTimers();
  });
});

describe("Rate limit headers and 429 response in API", () => {
  let db: InstanceType<typeof Database>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.RATE_LIMIT_PER_USER = "2";
    process.env.RATE_LIMIT_PER_CHANNEL = "100";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";

    db = createDb(":memory:");
    setDb(db);
    app = createApp();
  });

  it("includes rate limit headers on /subscribe", async () => {
    const res = await request(app).post("/subscribe").send({
      stellar_address: "GABCD1234",
      channel: "email",
      destination: "user@example.com",
      triggers: ["invoice_funded"],
    });

    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    expect(Number(res.headers["x-ratelimit-remaining"])).toBeGreaterThanOrEqual(0);
  });

  it("returns 429 after per-user limit is reached", async () => {
    const addr = "GLIMITUSER";
    const sub = {
      stellar_address: addr,
      channel: "email",
      destination: "limit@example.com",
      triggers: ["invoice_funded"],
    };

    await request(app).post("/subscribe").send(sub);
    await request(app).post("/subscribe").send({ ...sub, destination: "limit2@example.com" });
    const res = await request(app).post("/subscribe").send({ ...sub, destination: "limit3@example.com" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/i);
    expect(res.body.retryAfter).toBeTypeOf("number");
  });

  it("different users are tracked independently via API", async () => {
    const sub1 = {
      stellar_address: "GUSER1API",
      channel: "email",
      destination: "u1@example.com",
      triggers: ["invoice_funded"],
    };
    const sub2 = {
      stellar_address: "GUSER2API",
      channel: "email",
      destination: "u2@example.com",
      triggers: ["invoice_funded"],
    };

    await request(app).post("/subscribe").send(sub1);
    await request(app).post("/subscribe").send(sub1);
    const blocked = await request(app).post("/subscribe").send(sub1);
    expect(blocked.status).toBe(429);

    const allowed = await request(app).post("/subscribe").send(sub2);
    expect(allowed.status).toBe(201);
  });

  it("rate limit headers present on 429 response", async () => {
    const sub = {
      stellar_address: "GHEADERCHECK",
      channel: "email",
      destination: "h1@example.com",
      triggers: ["invoice_funded"],
    };

    await request(app).post("/subscribe").send(sub);
    await request(app).post("/subscribe").send(sub);
    const res = await request(app).post("/subscribe").send(sub);

    expect(res.status).toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(Number(res.headers["x-ratelimit-remaining"])).toBe(0);
  });
});

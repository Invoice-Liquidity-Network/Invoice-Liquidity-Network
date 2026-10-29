import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("subscription API recipient rate limits", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_PER_USER = "100";
    process.env.RATE_LIMIT_PER_RECIPIENT = "1";
    process.env.RATE_LIMIT_PER_CHANNEL = "100";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
  });

  it("limits a destination without blocking a different recipient on the same channel", async () => {
    vi.resetModules();
    const [{ createApp }, { createDb, setDb }] = await Promise.all([
      import("../api"),
      import("../db"),
    ]);
    setDb(createDb(":memory:"));
    const app = createApp();

    const subscription = {
      channel: "email",
      triggers: ["invoice_funded"],
    };

    const first = await request(app).post("/subscribe").send({
      ...subscription,
      stellar_address: "GRECIPIENT1",
      destination: "shared@example.com",
    });
    const sameRecipient = await request(app).post("/subscribe").send({
      ...subscription,
      stellar_address: "GRECIPIENT2",
      destination: "shared@example.com",
    });
    const differentRecipient = await request(app).post("/subscribe").send({
      ...subscription,
      stellar_address: "GRECIPIENT3",
      destination: "separate@example.com",
    });

    expect(first.status).toBe(201);
    expect(sameRecipient.status).toBe(429);
    expect(differentRecipient.status).toBe(201);
  });
});

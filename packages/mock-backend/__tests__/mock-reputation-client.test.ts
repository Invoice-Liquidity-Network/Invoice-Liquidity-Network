import { describe, it, expect } from "vitest";
import { MockReputationClient } from "../src/mock-reputation-client.js";
import { BOB, DAVE, FRANK } from "../src/seed.js";

describe("MockReputationClient", () => {
  it("returns score for known payer", async () => {
    const client = new MockReputationClient();
    const score = await client.getPayerScore(BOB);
    expect(score).not.toBeNull();
    expect(score!.score).toBeGreaterThanOrEqual(0);
    expect(score!.score).toBeLessThanOrEqual(100);
  });

  it("returns null for unknown payer", async () => {
    const client = new MockReputationClient();
    expect(await client.getPayerScore("GNOBODY")).toBeNull();
  });

  it("batch returns correct entries", async () => {
    const client = new MockReputationClient();
    const map = await client.getPayerScoresBatch([BOB, DAVE, FRANK, "GNOBODY"]);
    expect(map.size).toBe(4);
    expect(map.get(BOB)).not.toBeNull();
    expect(map.get(DAVE)).not.toBeNull();
    expect(map.get(FRANK)).not.toBeNull();
    expect(map.get("GNOBODY")).toBeNull();
  });

  it("BOB has zero defaults", async () => {
    const client = new MockReputationClient();
    const score = await client.getPayerScore(BOB);
    expect(score!.defaults).toBe(0);
  });

  it("DAVE has positive defaults", async () => {
    const client = new MockReputationClient();
    const score = await client.getPayerScore(DAVE);
    expect(score!.defaults).toBeGreaterThan(0);
  });
});

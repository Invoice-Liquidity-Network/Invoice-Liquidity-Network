import { describe, it, expect, beforeEach } from "vitest";
import { MockInvoiceClient } from "../src/mock-invoice-client.js";
import { ALICE, BOB, CAROL, DAVE, EVE, USDC_ID, EURC_ID } from "../src/seed.js";

function makeClient() {
  return new MockInvoiceClient();
}

describe("MockInvoiceClient — invoice reads", () => {
  it("getInvoiceCount returns 13 (seed size)", async () => {
    const client = makeClient();
    expect(await client.getInvoiceCount()).toBe(13n);
  });

  it("getInvoice returns the correct invoice", async () => {
    const client = makeClient();
    const inv = await client.getInvoice(1n);
    expect(inv.id).toBe(1n);
    expect(inv.status).toBe("Pending");
    expect(inv.freelancer).toBe(ALICE);
    expect(inv.payer).toBe(BOB);
  });

  it("getInvoice throws for unknown id", async () => {
    const client = makeClient();
    await expect(client.getInvoice(999n)).rejects.toThrow("not found");
  });

  it("getAllInvoices returns 13 entries", async () => {
    const client = makeClient();
    const all = await client.getAllInvoices();
    expect(all).toHaveLength(13);
  });

  it("getAllInvoices covers all statuses", async () => {
    const client = makeClient();
    const all = await client.getAllInvoices();
    const statuses = new Set(all.map((i) => i.status));
    expect(statuses).toContain("Pending");
    expect(statuses).toContain("Funded");
    expect(statuses).toContain("Paid");
    expect(statuses).toContain("Defaulted");
    expect(statuses).toContain("Cancelled");
    expect(statuses).toContain("Expired");
  });
});

describe("MockInvoiceClient — token reads", () => {
  it("getApprovedTokenIds returns USDC and EURC", async () => {
    const client = makeClient();
    const ids = await client.getApprovedTokenIds();
    expect(ids).toContain(USDC_ID);
    expect(ids).toContain(EURC_ID);
  });

  it("getTokenMetadata returns correct data for USDC", async () => {
    const client = makeClient();
    const meta = await client.getTokenMetadata(USDC_ID);
    expect(meta.symbol).toBe("USDC");
    expect(meta.decimals).toBe(7);
    expect(meta.contractId).toBe(USDC_ID);
  });

  it("getTokenMetadata returns placeholder for unknown token", async () => {
    const client = makeClient();
    const UNKNOWN = "CUNKNOWNTOKENADDRESSFORTEST000000000000000000000000000000";
    const meta = await client.getTokenMetadata(UNKNOWN);
    expect(meta.contractId).toBe(UNKNOWN);
    expect(meta.decimals).toBe(7);
  });

  it("getTokenBalance returns non-zero for seeded address", async () => {
    const client = makeClient();
    const bal = await client.getTokenBalance(ALICE, USDC_ID);
    expect(bal).toBeGreaterThan(0n);
  });

  it("getTokenBalance returns 0 for unknown address", async () => {
    const client = makeClient();
    const bal = await client.getTokenBalance("GNOBODY", USDC_ID);
    expect(bal).toBe(0n);
  });

  it("getTokenAllowance returns seeded allowance", async () => {
    const client = makeClient();
    const allowance = await client.getTokenAllowance({
      owner: CAROL,
      spender: "CONTRACT",
      tokenId: USDC_ID,
    });
    expect(allowance).toBeGreaterThan(0n);
  });
});

describe("MockInvoiceClient — reputation reads", () => {
  it("getPayerScore returns score for known payer", async () => {
    const client = makeClient();
    const score = await client.getPayerScore(BOB);
    expect(score).not.toBeNull();
    expect(score!.score).toBeGreaterThan(0);
  });

  it("getPayerScore returns null for unknown payer", async () => {
    const client = makeClient();
    const score = await client.getPayerScore("GNOBODY");
    expect(score).toBeNull();
  });

  it("getPayerScoresBatch returns correct map", async () => {
    const client = makeClient();
    const result = await client.getPayerScoresBatch([BOB, DAVE, "GNOBODY"]);
    expect(result.size).toBe(3);
    expect(result.get(BOB)).not.toBeNull();
    expect(result.get(DAVE)).not.toBeNull();
    expect(result.get("GNOBODY")).toBeNull();
  });
});

describe("MockInvoiceClient — write operations", () => {
  it("submitInvoice creates a new invoice and increments count", async () => {
    const client = makeClient();
    const result = await client.submitInvoice({
      freelancer: ALICE,
      payer: BOB,
      amount: 1_000_000_000n,
      dueDate: Math.floor(Date.now() / 1000) + 86_400 * 30,
      discountRate: 300,
      token: USDC_ID,
    });
    expect(result.invoiceId).toBe(14n);
    expect(result.txHash).toHaveLength(64);
    expect(await client.getInvoiceCount()).toBe(14n);
  });

  it("fundInvoice transitions Pending → Funded", async () => {
    const client = makeClient();
    await client.fundInvoice(CAROL, 1n);
    const inv = await client.getInvoice(1n);
    expect(inv.status).toBe("Funded");
    expect(inv.funder).toBe(CAROL);
    expect(inv.funded_at).not.toBeNull();
  });

  it("fundInvoice rejects non-Pending invoice", async () => {
    const client = makeClient();
    // Invoice 3 is already Funded in seed
    await expect(client.fundInvoice(CAROL, 3n)).rejects.toThrow(/expected status "Pending"/);
  });

  it("markPaid transitions Funded → Paid", async () => {
    const client = makeClient();
    // Invoice 3 is Funded, BOB is the payer
    await client.markPaid(BOB, 3n);
    const inv = await client.getInvoice(3n);
    expect(inv.status).toBe("Paid");
  });

  it("markPaid rejects wrong payer", async () => {
    const client = makeClient();
    await expect(client.markPaid(DAVE, 3n)).rejects.toThrow(/not the payer/);
  });

  it("claimDefault on past-due funded invoice transitions to Defaulted", async () => {
    const client = makeClient();
    // Create a fresh Funded invoice whose due_date is in the past
    const pastDue = Math.floor(Date.now() / 1000) - 86_400; // yesterday
    const { invoiceId } = await client.submitInvoice({
      freelancer: ALICE,
      payer: BOB,
      amount: 1_000_000_000n,
      dueDate: pastDue,
      discountRate: 500,
      token: USDC_ID,
    });
    await client.fundInvoice(CAROL, invoiceId);
    await client.claimDefault(CAROL, invoiceId);
    const inv = await client.getInvoice(invoiceId);
    expect(inv.status).toBe("Defaulted");
  });

  it("claimDefault on future-due invoice fails", async () => {
    const client = makeClient();
    // Invoice 3 is Funded but due in the future
    await expect(client.claimDefault(CAROL, 3n)).rejects.toThrow(/not past its due date/);
  });

  it("cancelInvoice transitions Pending → Cancelled", async () => {
    const client = makeClient();
    await client.cancelInvoice(ALICE, 1n);
    const inv = await client.getInvoice(1n);
    expect(inv.status).toBe("Cancelled");
  });

  it("cancelInvoice rejects wrong freelancer", async () => {
    const client = makeClient();
    await expect(client.cancelInvoice(EVE, 1n)).rejects.toThrow(/not the freelancer/);
  });

  it("updateInvoice mutates amount and due_date", async () => {
    const client = makeClient();
    await client.updateInvoice({
      freelancer: ALICE,
      invoiceId: 1n,
      amount: 9_999_999n,
      dueDate: Math.floor(Date.now() / 1000) + 86_400 * 60,
      discountRate: 200,
    });
    const inv = await client.getInvoice(1n);
    expect(inv.amount).toBe(9_999_999n);
    expect(inv.discount_rate).toBe(200);
  });

  it("approveToken sets allowance", async () => {
    const client = makeClient();
    await client.approveToken({ owner: BOB, amount: 5_000_000_000n, spender: "CONTRACT", tokenId: USDC_ID });
    const allowance = await client.getTokenAllowance({ owner: BOB, spender: "CONTRACT", tokenId: USDC_ID });
    expect(allowance).toBe(5_000_000_000n);
  });

  it("markPaid updates payer reputation score", async () => {
    const client = makeClient();
    const before = await client.getPayerScore(BOB);
    // Invoice 3 is Funded, BOB is payer
    await client.markPaid(BOB, 3n);
    const after = await client.getPayerScore(BOB);
    expect(after!.settled_on_time).toBe(before!.settled_on_time + 1);
  });
});

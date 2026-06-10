/**
 * Interface-compliance tests.
 * Verifies that the mock clients satisfy the declared TypeScript interfaces
 * by checking that every method exists and returns the right shape.
 */
import { describe, it, expect } from "vitest";
import { ILNMockBackend } from "../src/ILNMockBackend.js";
import type { InvoiceClient, ReputationClient, GovernanceClient } from "../src/types.js";
import { ALICE, BOB, USDC_ID } from "../src/seed.js";

describe("ILNMockBackend — client interface compliance", () => {
  const backend = new ILNMockBackend();

  // ── InvoiceClient ─────────────────────────────────────────────────────────

  it("invoice implements InvoiceClient", () => {
    const client: InvoiceClient = backend.invoice;
    expect(typeof client.getInvoiceCount).toBe("function");
    expect(typeof client.getInvoice).toBe("function");
    expect(typeof client.getAllInvoices).toBe("function");
    expect(typeof client.getTokenBalance).toBe("function");
    expect(typeof client.getTokenAllowance).toBe("function");
    expect(typeof client.getApprovedTokenIds).toBe("function");
    expect(typeof client.getTokenMetadata).toBe("function");
    expect(typeof client.getPayerScore).toBe("function");
    expect(typeof client.getPayerScoresBatch).toBe("function");
    expect(typeof client.submitInvoice).toBe("function");
    expect(typeof client.fundInvoice).toBe("function");
    expect(typeof client.markPaid).toBe("function");
    expect(typeof client.claimDefault).toBe("function");
    expect(typeof client.cancelInvoice).toBe("function");
    expect(typeof client.updateInvoice).toBe("function");
    expect(typeof client.approveToken).toBe("function");
  });

  // ── ReputationClient ──────────────────────────────────────────────────────

  it("reputation implements ReputationClient", () => {
    const client: ReputationClient = backend.reputation;
    expect(typeof client.getPayerScore).toBe("function");
    expect(typeof client.getPayerScoresBatch).toBe("function");
  });

  // ── GovernanceClient ──────────────────────────────────────────────────────

  it("governance implements GovernanceClient", () => {
    const client: GovernanceClient = backend.governance;
    expect(typeof client.fetchProposals).toBe("function");
    expect(typeof client.fetchProposal).toBe("function");
    expect(typeof client.castVote).toBe("function");
    expect(typeof client.executeProposal).toBe("function");
    expect(typeof client.getVotingPower).toBe("function");
    expect(typeof client.fetchProtocolParameters).toBe("function");
    expect(typeof client.createProposal).toBe("function");
  });

  // ── End-to-end: submit → fund → pay flow ──────────────────────────────────

  it("full lifecycle: submit → fund → mark paid", async () => {
    const b = new ILNMockBackend();
    const dueDate = Math.floor(Date.now() / 1000) + 86_400 * 30;

    const { invoiceId } = await b.invoice.submitInvoice({
      freelancer: ALICE,
      payer: BOB,
      amount: 1_000_000_000n,
      dueDate,
      discountRate: 300,
      token: USDC_ID,
    });

    let inv = await b.invoice.getInvoice(invoiceId);
    expect(inv.status).toBe("Pending");

    await b.invoice.fundInvoice(ALICE, invoiceId);
    inv = await b.invoice.getInvoice(invoiceId);
    expect(inv.status).toBe("Funded");

    await b.invoice.markPaid(BOB, invoiceId);
    inv = await b.invoice.getInvoice(invoiceId);
    expect(inv.status).toBe("Paid");
  });

  // ── Reputation score improves after payment ───────────────────────────────

  it("payer score updates after markPaid", async () => {
    const b = new ILNMockBackend();
    // Read score directly from the invoice client (which owns the reputation store)
    const scoreBefore = await b.invoice.getPayerScore(BOB);

    // Invoice 3 in seed is Funded, BOB is payer
    await b.invoice.markPaid(BOB, 3n);

    const scoreAfter = await b.invoice.getPayerScore(BOB);
    expect(scoreAfter!.settled_on_time).toBe(scoreBefore!.settled_on_time + 1);
  });
});

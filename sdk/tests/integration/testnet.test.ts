/**
 * SDK integration tests against the Stellar testnet (#233).
 *
 * Requires three funded testnet keypairs supplied as environment variables:
 *   FREELANCER_SECRET  — signs submit_invoice
 *   PAYER_SECRET       — signs mark_paid
 *   FUNDER_SECRET      — signs fund_invoice
 *
 * The suite is skipped automatically when:
 *   - Any of the three secrets is absent, OR
 *   - The Soroban RPC health endpoint is unreachable / unhealthy.
 *
 * In CI this job runs on push to main only (see .github/workflows/ci.yml).
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  Account,
  Address,
  BASE_FEE,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import { ILNSdk } from "../../src/client";
import { createKeypairSigner, ILN_TESTNET } from "../../src/signers";

// ── Secrets ──────────────────────────────────────────────────────────────────

const FREELANCER_SECRET = process.env.FREELANCER_SECRET;
const PAYER_SECRET = process.env.PAYER_SECRET;
const FUNDER_SECRET = process.env.FUNDER_SECRET;

const hasRequiredSecrets = Boolean(FREELANCER_SECRET && PAYER_SECRET && FUNDER_SECRET);

// ── Testnet health check ──────────────────────────────────────────────────────

async function checkTestnetHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${ILN_TESTNET.rpcUrl}/health`, {
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Top-level await: resolve once at module load so describe.skipIf gets a bool.
const isTestnetAvailable = await checkTestnetHealth();

const canRun = isTestnetAvailable && hasRequiredSecrets;

// ── Constants ─────────────────────────────────────────────────────────────────

const READ_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TX_TIMEOUT_MS = 60_000;
const INVOICE_AMOUNT = 10_000_000n; // 1 USDC (7 decimal stroops)
const DISCOUNT_RATE = 300; // 3%

// ── Raw contract read helper ──────────────────────────────────────────────────

type SimulationResultLike = {
  error?: unknown;
  result?: { retval?: xdr.ScVal };
};

async function readContract(method: string, args: xdr.ScVal[]): Promise<unknown> {
  const server = new rpc.Server(ILN_TESTNET.rpcUrl);
  const tx = new TransactionBuilder(new Account(READ_ACCOUNT, "0"), {
    fee: BASE_FEE,
    networkPassphrase: ILN_TESTNET.networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: ILN_TESTNET.contractId,
        function: method,
        args,
      }),
    )
    .setTimeout(60)
    .build();

  const simulation = (await server.simulateTransaction(tx)) as SimulationResultLike;

  if (simulation.error) {
    throw new Error(`Simulation failed for ${method}: ${String(simulation.error)}`);
  }
  if (!simulation.result?.retval) {
    throw new Error(`Simulation for ${method} did not return a contract result.`);
  }

  return scValToNative(simulation.result.retval);
}

function unwrapResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if ("ok" in value) return (value as { ok: unknown }).ok;
  if ("Ok" in value) return (value as { Ok: unknown }).Ok;
  if ("err" in value || "Err" in value) {
    throw new Error(`Contract returned an error: ${JSON.stringify(value)}`);
  }
  return value;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe.skipIf(!canRun)("SDK testnet integration (#233)", () => {
  let freelancerAddress: string;
  let payerAddress: string;
  let funderAddress: string;

  // Shared across the lifecycle tests so each one builds on the previous.
  let sharedInvoiceId: bigint;

  const freelancerSigner = createKeypairSigner(FREELANCER_SECRET!);
  const payerSigner = createKeypairSigner(PAYER_SECRET!);
  const funderSigner = createKeypairSigner(FUNDER_SECRET!);

  const freelancerSdk = new ILNSdk({ ...ILN_TESTNET, signer: freelancerSigner });
  const payerSdk = new ILNSdk({ ...ILN_TESTNET, signer: payerSigner });
  const funderSdk = new ILNSdk({ ...ILN_TESTNET, signer: funderSigner });

  beforeAll(async () => {
    freelancerAddress = await freelancerSigner.getPublicKey();
    payerAddress = await payerSigner.getPublicKey();
    funderAddress = await funderSigner.getPublicKey();
  });

  // ── submit_invoice ──────────────────────────────────────────────────────────

  it("submit_invoice — returns a valid bigint invoice ID", async () => {
    const dueDate = Math.floor(Date.now() / 1000) + 300; // 5 min window

    sharedInvoiceId = await freelancerSdk.submitInvoice({
      freelancer: freelancerAddress,
      payer: payerAddress,
      amount: INVOICE_AMOUNT,
      dueDate,
      discountRate: DISCOUNT_RATE,
    });

    expect(typeof sharedInvoiceId).toBe("bigint");
    expect(sharedInvoiceId).toBeGreaterThan(0n);
  }, TX_TIMEOUT_MS);

  // ── get_invoice (Pending) ───────────────────────────────────────────────────

  it("get_invoice — submitted invoice is Pending with correct fields", async () => {
    const invoice = await freelancerSdk.getInvoice(sharedInvoiceId);

    expect(invoice.id).toBe(sharedInvoiceId);
    expect(invoice.freelancer).toBe(freelancerAddress);
    expect(invoice.payer).toBe(payerAddress);
    expect(invoice.amount).toBe(INVOICE_AMOUNT);
    expect(invoice.discountRate).toBe(DISCOUNT_RATE);
    expect(invoice.status).toBe("Pending");
    expect(invoice.funder).toBeNull();
    expect(invoice.fundedAt).toBeNull();
  }, TX_TIMEOUT_MS);

  // ── fund_invoice ────────────────────────────────────────────────────────────

  it("fund_invoice — invoice transitions to Funded; funder and fundedAt are set", async () => {
    await funderSdk.fundInvoice({
      funder: funderAddress,
      invoiceId: sharedInvoiceId,
    });

    const invoice = await freelancerSdk.getInvoice(sharedInvoiceId);

    expect(invoice.status).toBe("Funded");
    expect(invoice.funder).toBe(funderAddress);
    expect(invoice.fundedAt).not.toBeNull();
    expect(typeof invoice.fundedAt).toBe("number");
  }, TX_TIMEOUT_MS);

  // ── mark_paid ───────────────────────────────────────────────────────────────

  it("mark_paid — invoice transitions from Funded to Paid", async () => {
    await payerSdk.markPaid({ invoiceId: sharedInvoiceId });

    const invoice = await freelancerSdk.getInvoice(sharedInvoiceId);

    expect(invoice.status).toBe("Paid");
    // Funder and amount should be preserved after payment.
    expect(invoice.funder).toBe(funderAddress);
    expect(invoice.amount).toBe(INVOICE_AMOUNT);
  }, TX_TIMEOUT_MS);

  // ── get_contract_stats ──────────────────────────────────────────────────────

  it("get_contract_stats — returns an object with non-negative numeric counters", async () => {
    const raw = await readContract("get_contract_stats", []);
    const stats = unwrapResult(raw) as Record<string, unknown>;

    expect(typeof stats).toBe("object");
    expect(stats).not.toBeNull();

    // At least one counter field should be a number/bigint.
    const numericValues = Object.values(stats).filter(
      (v) => typeof v === "bigint" || typeof v === "number",
    );
    expect(numericValues.length).toBeGreaterThan(0);

    // Regardless of exact field name, every numeric counter must be non-negative.
    for (const v of numericValues) {
      expect(Number(v)).toBeGreaterThanOrEqual(0);
    }

    // Total invoices should reflect at least the one we just processed.
    const total =
      stats["total_invoices"] ??
      stats["totalInvoices"] ??
      stats["invoices_submitted"] ??
      stats["total"];
    if (total != null) {
      expect(Number(total)).toBeGreaterThanOrEqual(1);
    }
  }, TX_TIMEOUT_MS);

  // ── get_reputation ──────────────────────────────────────────────────────────

  it("get_reputation — returns a reputation record for a known address", async () => {
    const raw = await readContract("get_reputation", [
      Address.fromString(freelancerAddress).toScVal(),
    ]);
    const reputation = unwrapResult(raw) as Record<string, unknown>;

    expect(typeof reputation).toBe("object");
    expect(reputation).not.toBeNull();

    // Score-like field must be a non-negative number.
    const score =
      reputation["score"] ??
      reputation["payer_score"] ??
      reputation["lp_score"] ??
      reputation["reputation_score"];

    if (score != null) {
      expect(Number(score)).toBeGreaterThanOrEqual(0);
    }

    // Invoice-count fields should be non-negative if present.
    for (const key of [
      "invoices_submitted",
      "invoices_paid",
      "invoices_defaulted",
      "invoicesSubmitted",
      "invoicesPaid",
    ]) {
      if (reputation[key] != null) {
        expect(Number(reputation[key])).toBeGreaterThanOrEqual(0);
      }
    }
  }, TX_TIMEOUT_MS);
});

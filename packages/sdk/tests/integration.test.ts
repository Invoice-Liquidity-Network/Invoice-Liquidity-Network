import { describe, expect, it } from "vitest";
import {
  Account,
  BASE_FEE,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
  Operation,
} from "@stellar/stellar-sdk";

import { ILNSdk } from "../src/client";
import { ILN_TESTNET, createKeypairSigner } from "../src/signers";

const READ_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TX_TIMEOUT_SECONDS = 60;
const INVOICE_AMOUNT = 10_000_000n;
const DISCOUNT_RATE = 300;
const DEFAULT_WAIT_BUFFER_SECONDS = 5;

const FREELANCER_SECRET = process.env.FREELANCER_SECRET;
const PAYER_SECRET = process.env.PAYER_SECRET;
const FUNDER_SECRET = process.env.FUNDER_SECRET;
const hasRequiredSecrets = Boolean(FREELANCER_SECRET && PAYER_SECRET && FUNDER_SECRET);

type SimulationResultLike = {
  error?: unknown;
  result?: {
    retval?: xdr.ScVal;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readContract(method: string, args: xdr.ScVal[]): Promise<unknown> {
  const server = new rpc.Server(ILN_TESTNET.rpcUrl);
  const readTx = new TransactionBuilder(new Account(READ_ACCOUNT, "0"), {
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
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();

  const simulation = (await server.simulateTransaction(readTx)) as SimulationResultLike;
  if (simulation.error) {
    throw new Error(`Simulation failed for ${method}: ${String(simulation.error)}`);
  }
  if (!simulation.result?.retval) {
    throw new Error(`Simulation for ${method} did not return a contract result.`);
  }

  return scValToNative(simulation.result.retval);
}

function unwrapResult(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if ("ok" in value) {
    return (value as { ok: unknown }).ok;
  }
  if ("Ok" in value) {
    return (value as { Ok: unknown }).Ok;
  }
  if ("err" in value || "Err" in value) {
    throw new Error(`Contract returned an error: ${JSON.stringify(value)}.`);
  }
  return value;
}

describe.skipIf(!hasRequiredSecrets)("SDK testnet integration", () => {
  const freelancerSigner = FREELANCER_SECRET ? createKeypairSigner(FREELANCER_SECRET) : null as any;
  const payerSigner = PAYER_SECRET ? createKeypairSigner(PAYER_SECRET) : null as any;
  const funderSigner = FUNDER_SECRET ? createKeypairSigner(FUNDER_SECRET) : null as any;

  const freelancerSdk = new ILNSdk({ ...ILN_TESTNET, signer: freelancerSigner });
  const payerSdk = new ILNSdk({ ...ILN_TESTNET, signer: payerSigner });
  const funderSdk = new ILNSdk({ ...ILN_TESTNET, signer: funderSigner });

  it("runs submit -> fund -> mark_paid and verifies LP yield", async () => {
    const freelancer = await freelancerSigner.getPublicKey();
    const payer = await payerSigner.getPublicKey();
    const funder = await funderSigner.getPublicKey();
    const dueDate = Math.floor(Date.now() / 1000) + 120;

    const invoiceId = await freelancerSdk.submitInvoice({
      freelancer,
      payer,
      amount: INVOICE_AMOUNT,
      dueDate,
      discountRate: DISCOUNT_RATE,
    });

    await funderSdk.fundInvoice({
      funder,
      invoiceId,
    });

    await payerSdk.markPaid({ invoiceId });

    const invoice = await freelancerSdk.getInvoice(invoiceId);
    expect(invoice.status).toBe("Paid");
    expect(invoice.funder).toBe(funder);

    const claimYieldRaw = await readContract("claim_yield", [
      nativeToScVal(invoiceId, { type: "u64" }),
    ]);
    const yieldValue = BigInt(unwrapResult(claimYieldRaw) as bigint | number | string);
    const expectedYield = (INVOICE_AMOUNT * BigInt(DISCOUNT_RATE)) / 10_000n;
    expect(yieldValue).toBe(expectedYield);
  }, 120_000);

  it("runs submit -> fund -> wait past due date -> claim_default and verifies default", async () => {
    const freelancer = await freelancerSigner.getPublicKey();
    const payer = await payerSigner.getPublicKey();
    const funder = await funderSigner.getPublicKey();
    const dueDate = Math.floor(Date.now() / 1000) + 20;

    const invoiceId = await freelancerSdk.submitInvoice({
      freelancer,
      payer,
      amount: INVOICE_AMOUNT,
      dueDate,
      discountRate: DISCOUNT_RATE,
    });

    await funderSdk.fundInvoice({
      funder,
      invoiceId,
    });

    const secondsUntilDue = Math.max(0, dueDate - Math.floor(Date.now() / 1000));
    await sleep((secondsUntilDue + DEFAULT_WAIT_BUFFER_SECONDS) * 1000);

    await funderSdk.claimDefault({
      funder,
      invoiceId,
    });

    const invoice = await freelancerSdk.getInvoice(invoiceId);
    expect(invoice.status).toBe("Defaulted");
  }, 180_000);
});

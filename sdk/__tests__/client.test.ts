import { describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Keypair,
  nativeToScVal,
  Operation,
  rpc,
} from "@stellar/stellar-sdk";

import { ILNSdk } from "../src/client";
import { createKeypairSigner } from "../src/signers";
import type { RpcServerLike, TransactionSigner } from "../src/types";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC";

function createSdk(server: RpcServerLike, signer?: TransactionSigner) {
  return new ILNSdk({
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: "https://example.test",
    server,
    signer,
  });
}

describe("ILNSdk", () => {
  it("returns a typed invoice from getInvoice", async () => {
    const freelancer = Keypair.random().publicKey();
    const payer = Keypair.random().publicKey();
    const funder = Keypair.random().publicKey();
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal({
            amount: 25000000n,
            discount_rate: 300,
            due_date: 1700000000,
            funder,
            funded_at: 1699999000,
            freelancer,
            id: 7n,
            payer,
            status: "Funded",
          }),
        },
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server);
    const invoice = await sdk.getInvoice(7n);

    expect(invoice).toEqual({
      amount: 25000000n,
      discountRate: 300,
      dueDate: 1700000000,
      funder,
      fundedAt: 1699999000,
      freelancer,
      id: 7n,
      payer,
      status: "Funded",
    });
  });

  it("submits an invoice and returns the simulated invoice id", async () => {
    const freelancerKeypair = Keypair.random();
    const payer = Keypair.random().publicKey();
    const signer = createKeypairSigner(freelancerKeypair.secret());
    const server = {
      getAccount: vi
        .fn()
        .mockResolvedValue(new Account(freelancerKeypair.publicKey(), "12")),
      prepareTransaction: vi.fn().mockImplementation(async (transaction) => transaction),
      sendTransaction: vi.fn().mockResolvedValue({
        hash: "a".repeat(64),
        status: "PENDING",
      }),
      pollTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal(11n, { type: "u64" }),
        },
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);
    const invoiceId = await sdk.submitInvoice({
      amount: 10000000n,
      discountRate: 250,
      dueDate: 1700000200,
      freelancer: freelancerKeypair.publicKey(),
      payer,
    });

    expect(invoiceId).toBe(11n);
    expect(server.getAccount).toHaveBeenCalledWith(freelancerKeypair.publicKey());
    expect(server.prepareTransaction).toHaveBeenCalledTimes(1);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
    expect(server.pollTransaction).toHaveBeenCalledWith("a".repeat(64), {
      attempts: 20,
    });
  });

  it("builds and simulates a batched transaction from matching operation sources", async () => {
    const freelancer = Keypair.random().publicKey();
    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(freelancer, "10")),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({}),
    } satisfies RpcServerLike;

    const sdk = createSdk(server);
    const operations = [
      Operation.invokeContractFunction({
        source: freelancer,
        contract: CONTRACT_ID,
        function: "submit_invoice",
        args: [
          Address.fromString(freelancer).toScVal(),
          Address.fromString(Keypair.random().publicKey()).toScVal(),
          nativeToScVal(10_000_000n, { type: "i128" }),
          nativeToScVal(1700000000, { type: "u64" }),
          nativeToScVal(300, { type: "u32" }),
        ],
      }),
      Operation.invokeContractFunction({
        source: freelancer,
        contract: CONTRACT_ID,
        function: "submit_invoice",
        args: [
          Address.fromString(freelancer).toScVal(),
          Address.fromString(Keypair.random().publicKey()).toScVal(),
          nativeToScVal(20_000_000n, { type: "i128" }),
          nativeToScVal(1700000200, { type: "u64" }),
          nativeToScVal(250, { type: "u32" }),
        ],
      }),
    ];

    const transaction = await sdk.batch(operations);

    expect(transaction.operations).toHaveLength(2);
    expect(transaction.operations[0].type).toBe("invokeHostFunction");
    expect(transaction.operations[0].source).toBe(freelancer);
    expect(transaction.operations[1].source).toBe(freelancer);
    expect(server.simulateTransaction).toHaveBeenCalledWith(transaction);
  });

  it("rejects a batch with more than 100 operations", async () => {
    const source = Keypair.random().publicKey();
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = createSdk(server);
    const operations = Array.from({ length: 101 }, () =>
      Operation.invokeContractFunction({
        source,
        contract: CONTRACT_ID,
        function: "mark_paid",
        args: [nativeToScVal(1n, { type: "u64" })],
      }),
    );

    await expect(sdk.batch(operations)).rejects.toThrow(
      "Batch cannot contain more than 100 operations.",
    );
  });

  it("reads and caches live protocol config", async () => {
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal({
            MIN_INVOICE_AMOUNT: 10000000n,
            MAX_DISCOUNT_RATE: 2000,
            PROTOCOL_FEE_BPS: 250,
            MIN_PAYER_REPUTATION: 70,
            DECAY_RATE_BPS: 25,
          }),
        },
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server);

    await expect(sdk.getProtocolConfig()).resolves.toEqual({
      minInvoiceAmount: 10000000n,
      maxDiscountRate: 2000,
      protocolFeeBps: 250,
      minPayerReputation: 70,
      decayRateBps: 25,
      maxInvoiceDuration: undefined,
      minInvoiceDuration: undefined,
      gracePeriodSeconds: undefined,
    });
    await sdk.getProtocolConfig();

    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects fundInvoice when the provided funder does not match the signer", async () => {
    const signer = createKeypairSigner(Keypair.random().secret());
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);

    await expect(
      sdk.fundInvoice({
        funder: Keypair.random().publicKey(),
        invoiceId: 2n,
      }),
    ).rejects.toThrow("fundInvoice must be signed by the funder address.");
  });

  it("marks an invoice as paid with the configured signer", async () => {
    const payerKeypair = Keypair.random();
    const signer = createKeypairSigner(payerKeypair.secret());
    const server = {
      getAccount: vi
        .fn()
        .mockResolvedValue(new Account(payerKeypair.publicKey(), "4")),
      prepareTransaction: vi.fn().mockImplementation(async (transaction) => transaction),
      sendTransaction: vi.fn().mockResolvedValue({
        hash: "b".repeat(64),
        status: "PENDING",
      }),
      pollTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);
    await sdk.markPaid({ invoiceId: 9n });

    expect(server.getAccount).toHaveBeenCalledWith(payerKeypair.publicKey());
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("throws when a transaction signer is required but not provided", async () => {
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = createSdk(server); // No signer
    
    await expect(sdk.markPaid({ invoiceId: 9n })).rejects.toThrow(
      "A transaction signer is required for state-changing contract calls."
    );
  });

  it("throws when simulation fails with an error", async () => {
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        error: "Some RPC failure",
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server);
    await expect(sdk.getInvoice(1n)).rejects.toThrow(
      "Simulation failed for get_invoice: Some RPC failure"
    );
  });

  it("throws when sendTransaction returns an invalid response", async () => {
    const payerKeypair = Keypair.random();
    const signer = createKeypairSigner(payerKeypair.secret());
    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(payerKeypair.publicKey(), "4")),
      prepareTransaction: vi.fn().mockImplementation(async (tx) => tx),
      sendTransaction: vi.fn().mockResolvedValue({}), // Missing hash and status
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);
    await expect(sdk.markPaid({ invoiceId: 9n })).rejects.toThrow(
      "RPC server returned an invalid sendTransaction response."
    );
  });

  it("throws when contract result is an Err", async () => {
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockResolvedValue({
        result: {
          retval: nativeToScVal({ err: "Invalid something" }),
        },
      }),
    } satisfies RpcServerLike;

    const sdk = createSdk(server);
    await expect(sdk.getInvoice(1n)).rejects.toThrow(
      "Contract method get_invoice returned an error: Invalid something."
    );
  });

  it("rejects submitInvoice when the provided freelancer does not match the signer", async () => {
    const signer = createKeypairSigner(Keypair.random().secret());
    const sdk = createSdk({} as any, signer);

    await expect(
      sdk.submitInvoice({
        freelancer: Keypair.random().publicKey(),
        payer: Keypair.random().publicKey(),
        amount: 100n,
        dueDate: 123,
        discountRate: 5,
      })
    ).rejects.toThrow("submitInvoice must be signed by the freelancer address.");
  });

  it("funds an invoice successfully", async () => {
    const funderKeypair = Keypair.random();
    const signer = createKeypairSigner(funderKeypair.secret());
    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(funderKeypair.publicKey(), "1")),
      prepareTransaction: vi.fn().mockImplementation(async (transaction) => transaction),
      sendTransaction: vi.fn().mockResolvedValue({
        hash: "c".repeat(64),
        status: "PENDING",
      }),
      pollTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);
    await sdk.fundInvoice({
      funder: funderKeypair.publicKey(),
      invoiceId: 4n,
    });

    expect(server.getAccount).toHaveBeenCalledWith(funderKeypair.publicKey());
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("claims a defaulted invoice with the funder signer", async () => {
    const funderKeypair = Keypair.random();
    const signer = createKeypairSigner(funderKeypair.secret());
    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(funderKeypair.publicKey(), "2")),
      prepareTransaction: vi.fn().mockImplementation(async (transaction) => transaction),
      sendTransaction: vi.fn().mockResolvedValue({
        hash: "d".repeat(64),
        status: "PENDING",
      }),
      pollTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);
    await sdk.claimDefault({
      funder: funderKeypair.publicKey(),
      invoiceId: 5n,
    });

    expect(server.getAccount).toHaveBeenCalledWith(funderKeypair.publicKey());
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects claimDefault when the provided funder does not match the signer", async () => {
    const signer = createKeypairSigner(Keypair.random().secret());
    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);

    await expect(
      sdk.claimDefault({
        funder: Keypair.random().publicKey(),
        invoiceId: 5n,
      }),
    ).rejects.toThrow("claimDefault must be signed by the funder address.");
  });

  it("throws when prepareTransaction fails", async () => {
    const payerKeypair = Keypair.random();
    const signer = createKeypairSigner(payerKeypair.secret());
    const server = {
      getAccount: vi.fn().mockResolvedValue(new Account(payerKeypair.publicKey(), "4")),
      prepareTransaction: vi.fn().mockRejectedValue(new Error("RPC Timeout")),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = createSdk(server, signer);
    await expect(sdk.markPaid({ invoiceId: 9n })).rejects.toThrow(
      "RPC Timeout"
    );
  });

  it("times out read-only contract calls with the configured read timeout", async () => {
    vi.useFakeTimers();

    const server = {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockReturnValue(new Promise(() => undefined)),
    } satisfies RpcServerLike;

    const sdk = new ILNSdk({
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: "https://example.test",
      server,
      timeouts: { readMs: 10 },
    });

    const promise = sdk.getInvoice(1n);
    const assertion = expect(promise).rejects.toMatchObject({
      name: "TimeoutError",
      operation: "simulateTransaction:get_invoice",
      timeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;

    vi.useRealTimers();
  });

  it("times out write RPC calls with the configured write timeout", async () => {
    vi.useFakeTimers();

    const payerKeypair = Keypair.random();
    const signer = createKeypairSigner(payerKeypair.secret());
    const server = {
      getAccount: vi.fn().mockReturnValue(new Promise(() => undefined)),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn(),
    } satisfies RpcServerLike;

    const sdk = new ILNSdk({
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: "https://example.test",
      server,
      signer,
      timeouts: { writeMs: 20 },
    });

    const promise = sdk.markPaid({ invoiceId: 9n });
    const assertion = expect(promise).rejects.toMatchObject({
      name: "TimeoutError",
      operation: "getAccount:mark_paid",
      timeoutMs: 20,
    });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;

    vi.useRealTimers();
  });

  it("times out pre-submit simulation calls with the configured simulation timeout", async () => {
    vi.useFakeTimers();

    const freelancerKeypair = Keypair.random();
    const signer = createKeypairSigner(freelancerKeypair.secret());
    const server = {
      getAccount: vi
        .fn()
        .mockResolvedValue(new Account(freelancerKeypair.publicKey(), "12")),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      simulateTransaction: vi.fn().mockReturnValue(new Promise(() => undefined)),
    } satisfies RpcServerLike;

    const sdk = new ILNSdk({
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: "https://example.test",
      server,
      signer,
      timeouts: { simulationMs: 30 },
    });

    const promise = sdk.submitInvoice({
      amount: 10000000n,
      discountRate: 250,
      dueDate: 1700000200,
      freelancer: freelancerKeypair.publicKey(),
      payer: Keypair.random().publicKey(),
    });
    const assertion = expect(promise).rejects.toMatchObject({
      name: "TimeoutError",
      operation: "simulateTransaction:submit_invoice",
      timeoutMs: 30,
    });
    await vi.advanceTimersByTimeAsync(30);
    await assertion;

    vi.useRealTimers();
  });
});

import { Keypair } from "@stellar/stellar-sdk";
import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { runCli } from "../src/cli";
import type { Invoice, ListedInvoice, ResolvedConfig } from "../src/types";

const TEST_CONFIG: ResolvedConfig = {
  contractId: validAddress("C"),
  keypairPath: "/tmp/iln.secret",
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  tokenId: validAddress("T"),
};

describe("runCli", () => {
  it("submits an invoice using config token fallback", async () => {
    const stdout = createMemoryStream();
    const stderr = createMemoryStream();
    const client = {
      submitInvoice: vi.fn().mockResolvedValue({ invoiceId: 42n, txHash: "abc123" }),
    };

    const exitCode = await runCli(
      ["submit", "--payer", validAddress(), "--amount", "100", "--due", "2025-12-31", "--rate", "300"],
      {
        createClient: () => client as any,
        loadConfig: () => TEST_CONFIG,
        stderr,
        stdout,
      },
    );

    expect(exitCode).toBe(0);
    expect(client.submitInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1_000_000_000n,
        discountRate: 300,
        tokenId: TEST_CONFIG.tokenId,
      }),
    );
    expect(stdout.toString()).toContain("Submitted invoice 42");
    expect(stderr.toString()).toBe("");
  });

  it("auto-funds the remaining balance when amount is omitted", async () => {
    const stdout = createMemoryStream();
    const client = {
      fundInvoice: vi.fn().mockResolvedValue({ hash: "tx-hash" }),
    };

    const exitCode = await runCli(["fund", "--id", "7"], {
      createClient: () => client as any,
      loadConfig: () => TEST_CONFIG,
      stderr: createMemoryStream(),
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(client.fundInvoice).toHaveBeenCalledWith(7n, undefined);
    expect(stdout.toString()).toContain("Funded invoice 7");
  });

  it("prints invoice status details", async () => {
    const stdout = createMemoryStream();
    const invoice: Invoice = {
      amount: 1_000_000_000n,
      amountFunded: 250_000_000n,
      discountRate: 300,
      dueDate: 1_767_225_599,
      freelancer: validAddress(),
      fundedAt: null,
      funder: null,
      id: 3n,
      payer: validAddress("B"),
      status: "Pending",
      token: "CTOKEN",
    };
    const client = {
      getInvoice: vi.fn().mockResolvedValue(invoice),
    };

    const exitCode = await runCli(["status", "--id", "3"], {
      createClient: () => client as any,
      loadConfig: () => TEST_CONFIG,
      stderr: createMemoryStream(),
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Status");
    expect(stdout.toString()).toContain("Pending");
  });

  it("lists invoices for an address", async () => {
    const stdout = createMemoryStream();
    const client = {
      listInvoicesByAddress: vi.fn().mockResolvedValue([
        createListedInvoice({ id: 1n, role: "freelancer", status: "Pending" }),
        createListedInvoice({ id: 2n, role: "payer", status: "Funded" }),
      ]),
    };

    const exitCode = await runCli(["list", "--address", validAddress()], {
      createClient: () => client as any,
      loadConfig: () => TEST_CONFIG,
      stderr: createMemoryStream(),
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("ID");
    expect(stdout.toString()).toContain("freelancer");
    expect(stdout.toString()).toContain("Funded");
  });

  it("prints live protocol configuration", async () => {
    const stdout = createMemoryStream();
    const client = {
      getProtocolConfig: vi.fn().mockResolvedValue({
        minInvoiceAmount: 10_000_000n,
        maxDiscountRate: 2_000,
        protocolFeeBps: 250,
        minPayerReputation: 70,
        decayRateBps: 25,
      }),
    };

    const exitCode = await runCli(["config"], {
      createClient: () => client as any,
      loadConfig: () => TEST_CONFIG,
      stderr: createMemoryStream(),
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(client.getProtocolConfig).toHaveBeenCalledTimes(1);
    expect(stdout.toString()).toContain("Min Amount");
    expect(stdout.toString()).toContain("10000000");
    expect(stdout.toString()).toContain("Fee");
  });

  it("prints actionable errors", async () => {
    const stderr = createMemoryStream();

    const exitCode = await runCli(["submit", "--payer", "not-a-key", "--amount", "100", "--due", "2025-12-31", "--rate", "300"], {
      createClient: () => ({}) as any,
      loadConfig: () => TEST_CONFIG,
      stderr,
      stdout: createMemoryStream(),
    });

    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain("Invalid payer address");
  });

  it("runs local dev status without requiring ILN config", async () => {
    const stdout = createMemoryStream();
    const status = vi.fn().mockResolvedValue(undefined);
    const loadConfig = vi.fn(() => {
      throw new Error("config should not be loaded");
    });

    const exitCode = await runCli(["dev", "status"], {
      createClient: () => ({}) as any,
      createDevEnvironment: () => ({
        reset: vi.fn(),
        start: vi.fn(),
        status,
        stop: vi.fn(),
      }),
      loadConfig,
      stderr: createMemoryStream(),
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(status).toHaveBeenCalledTimes(1);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("decodes ScVal XDR without requiring ILN config", async () => {
    const stdout = createMemoryStream();
    const loadConfig = vi.fn(() => {
      throw new Error("config should not be loaded");
    });

    const exitCode = await runCli(
      [
        "xdr",
        "decode",
        "AAAAEQAAAAEAAAADAAAADgAAAAZhbW91bnQAAAAAAAUAAAAAO5rKAAAAAA4AAAACaWQAAAAAAAUAAAAAAAAAKgAAAA4AAAAGc3RhdHVzAAAAAAAOAAAABkZ1bmRlZAAA",
      ],
      {
        createClient: () => ({}) as any,
        loadConfig,
        stderr: createMemoryStream(),
        stdout,
      },
    );

    expect(exitCode).toBe(0);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(stdout.toString()).toContain('"amount": "1000000000"');
    expect(stdout.toString()).toContain('"status": "Funded"');
  });
});

function createMemoryStream(): Writable & { toString(): string } {
  let output = "";
  return Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    }),
    {
      toString() {
        return output;
      },
    },
  );
}

function createListedInvoice(
  overrides: Partial<ListedInvoice> & Pick<ListedInvoice, "id" | "role" | "status">,
): ListedInvoice {
  const { id, role, status, ...rest } = overrides;
  return {
    amount: 1_000_000_000n,
    amountFunded: 0n,
    discountRate: 300,
    dueDate: 1_767_225_599,
    freelancer: validAddress(),
    fundedAt: null,
    funder: null,
    id,
    payer: validAddress("B"),
    role,
    status,
    token: "CTOKEN",
    ...rest,
  };
}

function validAddress(seed = "A"): string {
  return Keypair.random().publicKey();
}

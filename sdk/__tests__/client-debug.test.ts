import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, nativeToScVal, rpc } from "@stellar/stellar-sdk";

describe("ILNSdk debug logging", () => {
  const originalEnv = process.env.ILN_DEBUG;
  const originalConsoleDebug = console.debug;

  beforeEach(() => {
    vi.resetModules();
    process.env.ILN_DEBUG = "1";
    globalThis.console.debug = vi.fn();
  });

  afterEach(() => {
    process.env.ILN_DEBUG = originalEnv;
    globalThis.console.debug = originalConsoleDebug;
  });

  it("emits debug logs when ILN_DEBUG=1", async () => {
    const { ILNSdk } = await import("../src/client");
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
            funder: Keypair.random().publicKey(),
            funded_at: 1699999000,
            freelancer: Keypair.random().publicKey(),
            id: 7n,
            payer: Keypair.random().publicKey(),
            status: "Funded",
          }),
        },
      }),
    };

    const sdk = new ILNSdk({
      contractId: "CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://example.test",
      server,
    });

    await sdk.getInvoice(7n);

    expect(console.debug).toHaveBeenCalled();
  });
});

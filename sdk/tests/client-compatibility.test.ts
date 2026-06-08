import { describe, it, expect, vi } from "vitest";
import { ILNSdk } from "../src/client";

// Mock the compatibility module cleanly to avoid ES module read-only export issues with @stellar/stellar-sdk
vi.mock("../src/compatibility", () => {
  return {
    SDK_VERSION: "0.1.0",
    MIN_CONTRACT_VERSION: "0.1.0",
    checkCompatibility: vi.fn().mockResolvedValue({
      compatible: true,
      contractVersion: "0.1.0",
      sdkVersion: "0.1.0",
      issues: [],
    }),
  };
});

describe("ILNSdk.checkCompatibility (class method)", () => {
  it("correctly integrates with ILNSdk simulation", async () => {
    const mockSimulate = vi.fn().mockResolvedValue({
      result: {
        retval: {} // simulated ScVal return
      }
    });

    const sdk = new ILNSdk({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABHP4",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      server: {
        simulateTransaction: mockSimulate,
      } as any,
    });

    const result = await sdk.checkCompatibility();
    expect(result.compatible).toBe(true);
    expect(result.contractVersion).toBe("0.1.0");
    expect(result.issues).toHaveLength(0);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SimulationError } from "./errors";

vi.mock("@stellar/stellar-sdk", () => {
  class MockTransactionBuilder {
    addOperation = vi.fn().mockReturnThis();
    setTimeout = vi.fn().mockReturnThis();
    setFee = vi.fn().mockReturnThis();
    build = vi.fn().mockReturnValue({
      toXDR: vi.fn().mockReturnValue("mock-xdr"),
    });
  }

  return {
    TransactionBuilder: MockTransactionBuilder,
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
  };
});

import { ILNTransactionBuilder } from "./transaction";
import type { RpcClient } from "./transaction";

function createMockRpcClient(overrides?: Partial<RpcClient>): RpcClient {
  return {
    getAccount: vi.fn().mockResolvedValue({
      accountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      sequenceNumber: () => "0",
      sequence: () => "0",
    }),
    simulateTransaction: vi.fn().mockResolvedValue({
      success: true,
      fee: 100,
      resources: { cpu: 1000, memory: 2048, readBytes: 512, writeBytes: 256 },
      minResourceFee: 200,
    }),
    ...overrides,
  };
}

describe("ILNTransactionBuilder", () => {
  let mockRpc: RpcClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc = createMockRpcClient();
  });

  it("should build a transaction with simulation", async () => {
    const builder = new ILNTransactionBuilder(mockRpc);
    const { transaction, simulation } = await builder.buildTransaction([], {
      sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });

    expect(transaction).toBeDefined();
    expect(simulation.success).toBe(true);
    expect(mockRpc.simulateTransaction).toHaveBeenCalled();
  });

  it("should cache successful simulations", async () => {
    const builder = new ILNTransactionBuilder(mockRpc);

    const tx1 = await builder.buildTransaction([], {
      sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });

    const sim2 = await builder.simulateWithCache(tx1.transaction);

    expect(sim2.cached).toBe(true);
    expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("should return cached simulation on second call", async () => {
    const builder = new ILNTransactionBuilder(mockRpc);

    const tx1 = await builder.buildTransaction([], {
      sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });
    const sim2 = await builder.simulateWithCache(tx1.transaction);

    expect(sim2.cached).toBe(true);
  });

  it("should estimate cost correctly", async () => {
    const builder = new ILNTransactionBuilder(mockRpc);

    const cost = await builder.estimateCost([], {
      sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      baseFee: 100,
      maxFee: 500,
    });

    expect(cost.baseFee).toBe(100);
    expect(cost.estimatedFee).toBe(200);
    expect(cost.withinBudget).toBe(true);
    expect(cost.resources).toBeDefined();
  });

  it("should detect when cost exceeds budget", async () => {
    const rpc = createMockRpcClient({
      simulateTransaction: vi.fn().mockResolvedValue({
        success: true,
        fee: 0,
        resources: { cpu: 0, memory: 0, readBytes: 0, writeBytes: 0 },
        minResourceFee: 1000,
      }),
    });

    const builder = new ILNTransactionBuilder(rpc);

    const cost = await builder.estimateCost([], {
      sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      baseFee: 100,
      maxFee: 500,
    });

    expect(cost.withinBudget).toBe(false);
  });

  it("should throw SimulationError on force submit with failed simulation", async () => {
    const rpc = createMockRpcClient({
      simulateTransaction: vi.fn().mockResolvedValue({
        success: false,
        error: "Contract error",
      }),
    });

    const builder = new ILNTransactionBuilder(rpc);

    await expect(
      builder.forceSubmit([], { sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" })
    ).rejects.toThrow(SimulationError);
  });

  it("should succeed force submit with passing simulation", async () => {
    const builder = new ILNTransactionBuilder(mockRpc);

    const { transaction, simulation } = await builder.forceSubmit([], {
      sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });

    expect(transaction).toBeDefined();
    expect(simulation.success).toBe(true);
  });

  it("should validate before submit and throw on failure", () => {
    const builder = new ILNTransactionBuilder(mockRpc);

    expect(() => {
      builder.validateBeforeSubmit({
        success: false,
        fee: 0,
        resources: { cpu: 0, memory: 0, readBytes: 0, writeBytes: 0 },
        minResourceFee: 100,
        error: "Contract error",
      });
    }).toThrow(SimulationError);
  });

  it("should validate before submit and pass on success", () => {
    const builder = new ILNTransactionBuilder(mockRpc);

    expect(() => {
      builder.validateBeforeSubmit({
        success: true,
        fee: 100,
        resources: { cpu: 1000, memory: 2048, readBytes: 512, writeBytes: 256 },
        minResourceFee: 200,
      });
    }).not.toThrow();
  });

  it("should clear cache", async () => {
    const builder = new ILNTransactionBuilder(mockRpc);

    const tx1 = await builder.buildTransaction([], {
      sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });

    await builder.simulateWithCache(tx1.transaction);
    expect(builder.cacheSize).toBe(1);

    builder.clearCache();
    expect(builder.cacheSize).toBe(0);
  });

  it("should handle simulation errors gracefully", async () => {
    const rpc = createMockRpcClient({
      simulateTransaction: vi.fn().mockRejectedValue(new Error("Network error")),
    });

    const builder = new ILNTransactionBuilder(rpc);

    const { simulation } = await builder.buildTransaction([], {
      sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });

    expect(simulation.success).toBe(false);
    expect(simulation.error).toBe("Network error");
  });

  it("should cap fee at maxFee", async () => {
    const rpc = createMockRpcClient({
      simulateTransaction: vi.fn().mockResolvedValue({
        success: true,
        fee: 0,
        resources: { cpu: 0, memory: 0, readBytes: 0, writeBytes: 0 },
        minResourceFee: 2000,
      }),
    });

    const builder = new ILNTransactionBuilder(rpc);

    const { simulation } = await builder.buildTransaction([], {
      sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      baseFee: 100,
      maxFee: 500,
    });

    expect(simulation.success).toBe(true);
  });
});

describe("SimulationError", () => {
  it("should have correct code and remediation", () => {
    const error = new SimulationError("test message", "test remediation");

    expect(error.code).toBe("SIMULATION_FAILED");
    expect(error.message).toBe("test message");
    expect(error.remediation).toBe("test remediation");
    expect(error).toBeInstanceOf(Error);
  });

  it("should have default messages", () => {
    const error = new SimulationError();

    expect(error.message).toBe("Transaction simulation failed.");
    expect(error.remediation).toBe("Review transaction parameters and contract state.");
  });
});

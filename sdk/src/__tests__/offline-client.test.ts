import { describe, expect, it } from "vitest";
import { ILNSdk } from "../client";
import { createMemoryOfflineStorage } from "../offline";
import type { RpcServerLike } from "../types";

const server = {
  getAccount: async () => {
    throw new Error("network should not be called while offline");
  },
  simulateTransaction: async () => {
    throw new Error("network should not be called while offline");
  },
  prepareTransaction: async () => {
    throw new Error("network should not be called while offline");
  },
  sendTransaction: async () => {
    throw new Error("network should not be called while offline");
  },
  pollTransaction: async () => {
    throw new Error("network should not be called while offline");
  },
} satisfies RpcServerLike;

describe("ILNSdk offline queue integration", () => {
  it("queues invoice submissions instead of touching the network while offline", async () => {
    const client = new ILNSdk({
      contractId: "C_TEST_CONTRACT_ID",
      rpcUrl: "https://rpc.example.test",
      networkPassphrase: "Test SDF Network ; September 2015",
      server,
      offline: {
        storage: createMemoryOfflineStorage(),
        storageKey: "client_queue",
      },
    });

    client.setOfflineQueueOnline(false);

    const result = await client.submitInvoiceOrQueue({
      freelancer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: 1000n,
      dueDate: 1_800_000_000,
      discountRate: 300,
    });

    expect(result.queued).toBe(true);
    expect(client.getOfflineState()).toMatchObject({
      isOnline: false,
      queueSize: 1,
      pendingCount: 1,
    });
    expect(client.getOfflineQueue()[0].operation).toBe("submitInvoice");
  });
});

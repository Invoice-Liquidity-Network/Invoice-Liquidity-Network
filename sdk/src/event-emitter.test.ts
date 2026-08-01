import { describe, it, expect, vi } from "vitest";
import {
  ILNEventEmitter,
  type InvoiceEventData,
  type WalletEventData,
  type ErrorEventData,
  type ContractEvent,
} from "./event-emitter";

describe("ILNEventEmitter", () => {
  it("should emit and receive invoice events", () => {
    const emitter = new ILNEventEmitter();
    const listener = vi.fn();

    emitter.on("invoice:submitted", listener);

    const data: InvoiceEventData = {
      invoiceId: BigInt(1),
      freelancer: "GABC...",
      payer: "GDEF...",
      amount: BigInt(1000),
      timestamp: Date.now(),
    };

    emitter.emitInvoice("submitted", data);
    expect(listener).toHaveBeenCalledWith(data);
  });

  it("should emit and receive wallet events", () => {
    const emitter = new ILNEventEmitter();
    const listener = vi.fn();

    emitter.on("wallet:connected", listener);

    const data: WalletEventData = {
      address: "GABC...",
      network: "testnet",
      timestamp: Date.now(),
    };

    emitter.emitWallet("connected", data);
    expect(listener).toHaveBeenCalledWith(data);
  });

  it("should emit and receive error events", () => {
    const emitter = new ILNEventEmitter();
    const listener = vi.fn();

    emitter.on("error:simulation_failed", listener);

    const data: ErrorEventData = {
      code: "SIMULATION_FAILED",
      message: "Transaction simulation failed",
      operation: "submitInvoice",
      timestamp: Date.now(),
    };

    emitter.emitError("simulation_failed", data);
    expect(listener).toHaveBeenCalledWith(data);
  });

  it("should emit wildcard error events", () => {
    const emitter = new ILNEventEmitter();
    const listener = vi.fn();

    emitter.on("error:*", listener);

    const data: ErrorEventData = {
      code: "NETWORK_ERROR",
      message: "Connection refused",
      timestamp: Date.now(),
    };

    emitter.emitError("network_error", data);
    expect(listener).toHaveBeenCalledWith(data);
  });

  it("should emit contract events", () => {
    const emitter = new ILNEventEmitter();
    const listener = vi.fn();

    emitter.on("contract:InvoiceCreated", listener);

    const event: ContractEvent = {
      contractId: "CABC...",
      type: "InvoiceCreated",
      ledger: 100,
      ledgerClosedAt: "2024-01-01T00:00:00Z",
      txHash: "abc123",
      pagingToken: "token1",
      invoice: {
        id: BigInt(1),
        freelancer: "GABC...",
        payer: "GDEF...",
        amount: BigInt(1000),
        dueDate: 1704067200,
        discountRate: 500,
        status: "Pending",
        funder: null,
        fundedAt: null,
      },
    } as ContractEvent;

    emitter.emitContract(event);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("should remove listener with returned unsubscribe function", () => {
    const emitter = new ILNEventEmitter();
    const listener = vi.fn();

    const unsub = emitter.on("invoice:funded", listener);
    unsub();

    emitter.emitInvoice("funded", {
      invoiceId: BigInt(1),
      funder: "GABC...",
      amount: BigInt(500),
      timestamp: Date.now(),
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("should support once listener", () => {
    const emitter = new ILNEventEmitter();
    const listener = vi.fn();

    emitter.once("invoice:paid", listener);

    const data: InvoiceEventData = {
      invoiceId: BigInt(1),
      payer: "GABC...",
      amount: BigInt(1000),
      timestamp: Date.now(),
    };

    emitter.emitInvoice("paid", data);
    emitter.emitInvoice("paid", data);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("should track event history", () => {
    const emitter = new ILNEventEmitter();

    emitter.emitInvoice("submitted", {
      invoiceId: BigInt(1),
      timestamp: Date.now(),
    });

    emitter.emitWallet("connected", {
      address: "GABC...",
      timestamp: Date.now(),
    });

    expect(emitter.getHistoryCount()).toBe(2);

    const invoiceHistory = emitter.getHistory({ category: "invoice" });
    expect(invoiceHistory).toHaveLength(1);
    expect(invoiceHistory[0].category).toBe("invoice");
  });

  it("should limit history size", () => {
    const emitter = new ILNEventEmitter({ maxHistorySize: 3 });

    for (let i = 0; i < 5; i++) {
      emitter.emitInvoice("submitted", {
        invoiceId: BigInt(i),
        timestamp: Date.now(),
      });
    }

    expect(emitter.getHistoryCount()).toBe(3);
    const history = emitter.getHistory();
    expect(history[0].data).toMatchObject({ invoiceId: BigInt(2) });
  });

  it("should clear history", () => {
    const emitter = new ILNEventEmitter();

    emitter.emitInvoice("submitted", {
      invoiceId: BigInt(1),
      timestamp: Date.now(),
    });

    emitter.clearHistory();
    expect(emitter.getHistoryCount()).toBe(0);
  });

  it("should count listeners correctly", () => {
    const emitter = new ILNEventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    emitter.on("invoice:submitted", listener1);
    emitter.on("invoice:funded", listener2);

    expect(emitter.listenerCount("invoice:submitted")).toBe(1);
    expect(emitter.listenerCount()).toBe(2);
  });

  it("should remove all listeners for a specific event", () => {
    const emitter = new ILNEventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    emitter.on("invoice:submitted", listener1);
    emitter.on("invoice:funded", listener2);

    emitter.removeAllListeners("invoice:submitted");

    emitter.emitInvoice("submitted", {
      invoiceId: BigInt(1),
      timestamp: Date.now(),
    });
    emitter.emitInvoice("funded", {
      invoiceId: BigInt(1),
      funder: "GABC...",
      amount: BigInt(500),
      timestamp: Date.now(),
    });

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("should remove all listeners", () => {
    const emitter = new ILNEventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    emitter.on("invoice:submitted", listener1);
    emitter.on("wallet:connected", listener2);

    emitter.removeAllListeners();

    emitter.emitInvoice("submitted", {
      invoiceId: BigInt(1),
      timestamp: Date.now(),
    });
    emitter.emitWallet("connected", {
      address: "GABC...",
      timestamp: Date.now(),
    });

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
  });

  it("should filter history by type", () => {
    const emitter = new ILNEventEmitter();

    emitter.emitInvoice("submitted", {
      invoiceId: BigInt(1),
      timestamp: Date.now(),
    });
    emitter.emitInvoice("funded", {
      invoiceId: BigInt(2),
      funder: "GABC...",
      amount: BigInt(500),
      timestamp: Date.now(),
    });

    const submittedHistory = emitter.getHistory({ type: "submitted" });
    expect(submittedHistory).toHaveLength(1);
    expect(submittedHistory[0].type).toBe("submitted");
  });

  it("should limit history results", () => {
    const emitter = new ILNEventEmitter();

    for (let i = 0; i < 10; i++) {
      emitter.emitInvoice("submitted", {
        invoiceId: BigInt(i),
        timestamp: Date.now(),
      });
    }

    const limited = emitter.getHistory({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("should handle async listeners", async () => {
    const emitter = new ILNEventEmitter();
    const listener = vi.fn().mockResolvedValue(undefined);

    emitter.on("invoice:submitted", listener);

    emitter.emitInvoice("submitted", {
      invoiceId: BigInt(1),
      timestamp: Date.now(),
    });

    expect(listener).toHaveBeenCalled();
  });

  it("should swallow listener errors", () => {
    const emitter = new ILNEventEmitter();
    const failingListener = vi.fn().mockImplementation(() => {
      throw new Error("listener error");
    });
    const normalListener = vi.fn();

    emitter.on("invoice:submitted", failingListener);
    emitter.on("invoice:submitted", normalListener);

    emitter.emitInvoice("submitted", {
      invoiceId: BigInt(1),
      timestamp: Date.now(),
    });

    expect(failingListener).toHaveBeenCalled();
    expect(normalListener).toHaveBeenCalled();
  });
});

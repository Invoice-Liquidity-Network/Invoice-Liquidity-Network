import { describe, it, expect, beforeEach } from "vitest";
import {
  loadBatchHistory,
  saveBatchEntry,
  clearBatchHistory,
  aggregateBatchStats,
  exportBatchResultsAsCsv,
  type BatchHistoryEntry,
} from "./batchHistory";

const mockEntry: BatchHistoryEntry = {
  id: "batch-1",
  timestamp: Date.now(),
  totalInvoices: 5,
  succeeded: 3,
  failed: 2,
  results: [
    { index: 0, success: true, invoiceId: 1n },
    { index: 1, success: true, invoiceId: 2n },
    { index: 2, success: true, invoiceId: 3n },
    { index: 3, success: false, error: "Insufficient balance" },
    { index: 4, success: false, error: "Invalid payer" },
  ],
  totalFee: "500",
  durationMs: 3000,
};

describe("batchHistory", () => {
  beforeEach(() => {
    clearBatchHistory();
  });

  it("starts with empty history", () => {
    expect(loadBatchHistory()).toHaveLength(0);
  });

  it("saves and loads a batch entry", () => {
    saveBatchEntry(mockEntry);
    const history = loadBatchHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("batch-1");
    expect(history[0].totalInvoices).toBe(5);
  });

  it("prepends new entries", () => {
    saveBatchEntry({ ...mockEntry, id: "first" });
    saveBatchEntry({ ...mockEntry, id: "second" });
    const history = loadBatchHistory();
    expect(history[0].id).toBe("second");
    expect(history[1].id).toBe("first");
  });

  it("clears history", () => {
    saveBatchEntry(mockEntry);
    clearBatchHistory();
    expect(loadBatchHistory()).toHaveLength(0);
  });
});

describe("aggregateBatchStats", () => {
  it("aggregates across multiple entries", () => {
    const history = [
      { ...mockEntry, succeeded: 3, failed: 2, totalInvoices: 5 },
      { ...mockEntry, id: "batch-2", succeeded: 5, failed: 0, totalInvoices: 5 },
    ];
    const stats = aggregateBatchStats(history);
    expect(stats.totalBatches).toBe(2);
    expect(stats.totalInvoices).toBe(10);
    expect(stats.totalSucceeded).toBe(8);
    expect(stats.totalFailed).toBe(2);
    expect(stats.successRate).toBe(80);
  });

  it("returns zero for empty history", () => {
    const stats = aggregateBatchStats([]);
    expect(stats.totalBatches).toBe(0);
    expect(stats.successRate).toBe(0);
  });
});

describe("exportBatchResultsAsCsv", () => {
  it("generates CSV string", () => {
    const csv = exportBatchResultsAsCsv(mockEntry);
    expect(csv).toContain("index,invoice_id,success,error");
    expect(csv).toContain("1,1,true,");
    expect(csv).toContain("4,,false,\"Insufficient balance\"");
  });
});

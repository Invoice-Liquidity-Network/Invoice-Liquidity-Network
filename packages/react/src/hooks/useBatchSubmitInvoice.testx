import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBatchSubmitInvoice } from "./useBatchSubmitInvoice";
import type { BatchInvoiceInput } from "./useBatchSubmitInvoice";
import type { BatchResult } from "@iln/sdk";
import { createMockILNClient } from "../test/mocks";
import { TestWrapper } from "../test/wrapper";

const validInvoices: BatchInvoiceInput[] = [
  {
    freelancer: "GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2",
    payer: "GDELEGATE000000000000000000000000000000000000000000000001",
    amount: 1000000000n,
    dueDate: 1800000000,
    discountRate: 300,
  },
  {
    freelancer: "GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2",
    payer: "GDELEGATE000000000000000000000000000000000000000000000002",
    amount: 2000000000n,
    dueDate: 1800000100,
    discountRate: 500,
  },
];

const allSuccessResult: BatchResult = {
  success: true,
  results: [
    { index: 0, success: true, invoiceId: 1n },
    { index: 1, success: true, invoiceId: 2n },
  ],
  totalFee: 500n,
};

const partialFailureResult: BatchResult = {
  success: false,
  results: [
    { index: 0, success: true, invoiceId: 1n },
    { index: 1, success: false, error: "Insufficient balance" },
  ],
  totalFee: 500n,
};

describe("useBatchSubmitInvoice", () => {
  it("returns initial idle state", () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useBatchSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.batchProgress).toBeNull();
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("submits invoices and updates progress on success", async () => {
    const mockClient = createMockILNClient({
      batchSubmitInvoices: vi.fn().mockResolvedValue(allSuccessResult),
    });

    const { result } = renderHook(() => useBatchSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.submitBatch(validInvoices);
    });

    expect(result.current.batchProgress).not.toBeNull();
    expect(result.current.batchProgress!.totalCount).toBe(2);
    expect(result.current.batchProgress!.completedCount).toBe(2);
    expect(result.current.batchProgress!.successCount).toBe(2);
    expect(result.current.batchProgress!.failedCount).toBe(0);
    expect(result.current.batchProgress!.isComplete).toBe(true);
  });

  it("handles partial failures", async () => {
    const mockClient = createMockILNClient({
      batchSubmitInvoices: vi.fn().mockResolvedValue(partialFailureResult),
    });

    const { result } = renderHook(() => useBatchSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.submitBatch(validInvoices);
    });

    expect(result.current.batchProgress!.successCount).toBe(1);
    expect(result.current.batchProgress!.failedCount).toBe(1);
    expect(result.current.batchProgress!.invoices[0].status).toBe("success");
    expect(result.current.batchProgress!.invoices[1].status).toBe("failed");
    expect(result.current.failedInvoices).toHaveLength(1);
  });

  it("rejects empty invoice arrays", async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useBatchSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await expect(result.current.submitBatch([])).rejects.toThrow("No invoices to submit");
    });
  });

  it("rejects more than 10 invoices", async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useBatchSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    const tooMany = Array.from({ length: 11 }, (_, i) => ({
      ...validInvoices[0],
      payer: `G${String(i).padStart(55, "0")}`,
    }));

    await act(async () => {
      await expect(result.current.submitBatch(tooMany)).rejects.toThrow("Maximum 10 invoices");
    });
  });

  it("handles total submission failure", async () => {
    const mockError = new Error("Network error");
    const mockClient = createMockILNClient({
      batchSubmitInvoices: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(() => useBatchSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.submitBatch(validInvoices).catch(() => undefined);
    });

    expect(result.current.batchProgress).not.toBeNull();
    expect(result.current.batchProgress!.failedCount).toBe(2);
    expect(result.current.batchProgress!.invoices.every((i) => i.status === "failed")).toBe(true);
  });

  it("reset clears progress and error", async () => {
    const mockClient = createMockILNClient({
      batchSubmitInvoices: vi.fn().mockRejectedValue(new Error("oops")),
    });

    const { result } = renderHook(() => useBatchSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.submitBatch(validInvoices).catch(() => undefined);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.batchProgress).toBeNull();
  });

  it("optimistically marks all invoices as submitting", async () => {
    const mockClient = createMockILNClient({
      batchSubmitInvoices: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(allSuccessResult), 50)),
      ),
    });

    const { result } = renderHook(() => useBatchSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    const promise = act(async () => {
      const p = result.current.submitBatch(validInvoices);
      expect(result.current.batchProgress!.invoices.every((i) => i.status === "submitting")).toBe(true);
      await p;
    });
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BatchInvoiceForm } from "./BatchInvoiceForm";
import { ILNContext } from "../context/ILNContext";
import { createMockILNClient } from "../test/mocks";
import type { ILNClient } from "@invoice-liquidity/sdk";

function renderWithProviders(
  ui: React.ReactElement,
  client: ILNClient = createMockILNClient(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ILNContext.Provider value={client}>{ui}</ILNContext.Provider>
    </QueryClientProvider>,
  );
}

describe("BatchInvoiceForm", () => {
  const freelancer = "GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2";

  it("renders initial form with one invoice row", () => {
    renderWithProviders(
      <BatchInvoiceForm freelancer={freelancer} />,
    );
    expect(screen.getByText("Batch Submit Invoices")).toBeDefined();
    expect(screen.getByText("Import CSV")).toBeDefined();
    expect(screen.getByText(/Submit 0 Invoice/)).toBeDefined();
  });

  it("adds invoice rows", () => {
    renderWithProviders(
      <BatchInvoiceForm freelancer={freelancer} />,
    );
    fireEvent.click(screen.getByText("+ Add Invoice"));
    expect(screen.getByText("2/10")).toBeDefined();
  });

  it("removes invoice rows", () => {
    renderWithProviders(
      <BatchInvoiceForm freelancer={freelancer} />,
    );
    fireEvent.click(screen.getByText("+ Add Invoice"));
    const removeButtons = screen.getAllByRole('button', { name: /Remove invoice/i });
    fireEvent.click(removeButtons[0]);
    expect(screen.getByText("1/10")).toBeDefined();
  });

  it("shows CSV import button", () => {
    renderWithProviders(
      <BatchInvoiceForm freelancer={freelancer} />,
    );
    expect(screen.getByText("Import CSV")).toBeDefined();
  });

  it("disables submit button when no valid invoices", () => {
    renderWithProviders(
      <BatchInvoiceForm freelancer={freelancer} />,
    );
    const submitButton = screen.getByRole("button", { name: /submit/i });
    expect(submitButton.hasAttribute("disabled")).toBe(true);
  });

  it("enables submit button with valid invoices", () => {
    renderWithProviders(
      <BatchInvoiceForm freelancer={freelancer} />,
    );
    const payerInput = screen.getByPlaceholderText("payer (G...)");
    fireEvent.change(payerInput, {
      target: { value: "GDELEGATE000000000000000000000000000000000000000000000001" },
    });
    const amountInput = screen.getByPlaceholderText("amount");
    fireEvent.change(amountInput, { target: { value: "100" } });
    const rateInput = screen.getByPlaceholderText("rate bps");
    fireEvent.change(rateInput, { target: { value: "300" } });
    const dueDateInput = screen.getByPlaceholderText("due date (unix)");
    fireEvent.change(dueDateInput, { target: { value: "1800000000" } });
    const submitButton = screen.getByRole("button", { name: /submit/i });
    expect(submitButton.hasAttribute("disabled")).toBe(false);
  });

  it("calls onComplete after successful submission", async () => {
    const onComplete = vi.fn();
    const mockClient = createMockILNClient({
      batchSubmitInvoices: vi.fn().mockResolvedValue({
        success: true,
        results: [
          { index: 0, success: true, invoiceId: 1n },
          { index: 1, success: true, invoiceId: 2n },
        ],
        totalFee: 500n,
      }),
    });

    renderWithProviders(
      <BatchInvoiceForm freelancer={freelancer} onComplete={onComplete} />,
      mockClient,
    );

    const payerInput = screen.getByPlaceholderText("payer (G...)");
    fireEvent.change(payerInput, {
      target: { value: "GDELEGATE000000000000000000000000000000000000000000000001" },
    });
    const amountInput = screen.getByPlaceholderText("amount");
    fireEvent.change(amountInput, { target: { value: "100" } });
    const rateInput = screen.getByPlaceholderText("rate bps");
    fireEvent.change(rateInput, { target: { value: "300" } });
    const dueDateInput = screen.getByPlaceholderText("due date (unix)");
    fireEvent.change(dueDateInput, { target: { value: "1800000000" } });

    fireEvent.click(screen.getByText("+ Add Invoice"));

    const secondPayer = screen.getAllByPlaceholderText("payer (G...)")[1];
    fireEvent.change(secondPayer, {
      target: { value: "GDELEGATE000000000000000000000000000000000000000000000002" },
    });
    const secondAmount = screen.getAllByPlaceholderText("amount")[1];
    fireEvent.change(secondAmount, { target: { value: "200" } });
    const secondRate = screen.getAllByPlaceholderText("rate bps")[1];
    fireEvent.change(secondRate, { target: { value: "500" } });
    const secondDueDate = screen.getAllByPlaceholderText("due date (unix)")[1];
    fireEvent.change(secondDueDate, { target: { value: "1800000100" } });

    const submitButton = screen.getByRole("button", { name: /submit 2 invoice/i });
    fireEvent.click(submitButton);

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({ succeeded: 2, failed: 0 });
    }, { timeout: 5000 });
  });
});

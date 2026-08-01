import { useState, useRef, useCallback } from "react";
import { useBatchSubmitInvoice } from "../hooks/useBatchSubmitInvoice";
import type { BatchInvoiceInput, InvoiceProgress, BatchProgress } from "../hooks/useBatchSubmitInvoice";
import { parseCsv, formatBatchErrorSummary } from "../utils/csvImport";
import type { CsvInvoiceRow, CsvValidationError } from "../utils/csvImport";
import { saveBatchEntry } from "../utils/batchHistory";
import type { BatchHistoryEntry } from "../utils/batchHistory";

interface BatchInvoiceFormProps {
  freelancer: string;
  onComplete?: (results: { succeeded: number; failed: number }) => void;
  maxInvoices?: number;
}

function InvoiceRowInput({
  index,
  invoice,
  onChange,
  onRemove,
}: {
  index: number;
  invoice: BatchInvoiceInput;
  onChange: (index: number, field: keyof BatchInvoiceInput, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 p-2 border border-gray-200 rounded bg-white">
      <span className="text-xs text-gray-400 w-5 font-mono">{index + 1}</span>
      <input
        className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-200 rounded font-mono"
        placeholder="payer (G...)"
        value={invoice.payer}
        onChange={(e) => onChange(index, "payer", e.target.value)}
      />
      <input
        className="w-24 px-2 py-1 text-xs border border-gray-200 rounded"
        type="number"
        step="0.01"
        min="0"
        placeholder="amount"
        value={Number(invoice.amount) / 10_000_000}
        onChange={(e) => onChange(index, "amount", e.target.value)}
      />
      <input
        className="w-20 px-2 py-1 text-xs border border-gray-200 rounded"
        type="number"
        placeholder="rate bps"
        value={invoice.discountRate}
        onChange={(e) => onChange(index, "discountRate", e.target.value)}
      />
      <input
        className="w-28 px-2 py-1 text-xs border border-gray-200 rounded"
        type="number"
        placeholder="due date (unix)"
        value={invoice.dueDate}
        onChange={(e) => onChange(index, "dueDate", e.target.value)}
      />
      <button
        onClick={() => onRemove(index)}
        className="text-red-400 hover:text-red-600 text-sm px-1"
        aria-label={`Remove invoice ${index + 1}`}
      >
        x
      </button>
    </div>
  );
}

function ProgressTracker({ progress }: { progress: BatchProgress }) {
  const pct = progress.totalCount > 0
    ? Math.round((progress.completedCount / progress.totalCount) * 100)
    : 0;
  const elapsed = Math.floor((Date.now() - progress.startedAt) / 1000);
  const remaining =
    progress.completedCount > 0 && progress.completedCount < progress.totalCount
      ? Math.round((elapsed / progress.completedCount) * (progress.totalCount - progress.completedCount))
      : 0;

  const statusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <span className="w-3 h-3 rounded-full bg-gray-300 inline-block" />;
      case "submitting":
        return <span className="w-3 h-3 rounded-full bg-blue-400 animate-pulse inline-block" />;
      case "success":
        return <span className="text-green-500 text-xs">check</span>;
      case "failed":
        return <span className="text-red-500 text-xs">x</span>;
      default:
        return null;
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">
          Batch Progress ({progress.completedCount}/{progress.totalCount})
        </h3>
        <span className="text-xs text-gray-400">
          {elapsed}s elapsed{remaining > 0 ? ` \u00b7 ~${remaining}s remaining` : ""}
        </span>
      </div>

      <div
        className="w-full bg-gray-100 rounded-full h-2 mb-3"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Batch progress: ${pct}%`}
      >
        <div
          className={`h-2 rounded-full transition-all duration-300 ${
            pct === 100 ? "bg-green-500" : pct > 50 ? "bg-blue-500" : "bg-blue-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex gap-4 text-xs mb-3">
        <span className="text-green-600">{progress.successCount} succeeded</span>
        <span className="text-red-600">{progress.failedCount} failed</span>
        <span className="text-gray-400">{progress.totalCount - progress.completedCount} pending</span>
      </div>

      <div className="space-y-1 max-h-40 overflow-y-auto">
        {progress.invoices.map((inv) => (
          <div
            key={inv.index}
            className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-gray-50"
          >
            {statusIcon(inv.status)}
            <span className="font-mono text-gray-500 w-5">{inv.index + 1}.</span>
            <span className="font-mono text-gray-700 flex-1 truncate">
              {inv.payer.slice(0, 8)}...
            </span>
            <span className="text-gray-400">
              {Number(inv.amount) / 10_000_000} USDC
            </span>
            {inv.status === "success" && inv.invoiceId !== undefined && (
              <span className="text-green-600 font-mono">#{String(inv.invoiceId)}</span>
            )}
            {inv.status === "failed" && inv.error && (
              <span className="text-red-500 truncate max-w-[200px]" title={inv.error}>
                {inv.error}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorSummary({ results }: { results: InvoiceProgress[] }) {
  const failed = results.filter((r) => r.status === "failed");
  if (failed.length === 0) return null;

  const summaries = formatBatchErrorSummary(
    failed.map((r) => ({ index: r.index, success: false, error: r.error })),
  );

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
      <h4 className="text-sm font-semibold text-red-700 mb-1">
        {failed.length} invoice(s) failed
      </h4>
      {summaries.map((s, i) => (
        <p key={i} className="text-xs text-red-600 mb-0.5">{s}</p>
      ))}
    </div>
  );
}

function CsvPreview({
  rows,
  onConfirm,
  onCancel,
  errors,
}: {
  rows: CsvInvoiceRow[];
  onConfirm: () => void;
  onCancel: () => void;
  errors: CsvValidationError[];
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        CSV Preview ({rows.length} invoice{rows.length !== 1 ? "s" : ""})
      </h3>

      {errors.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3">
          <p className="text-xs font-medium text-yellow-700 mb-1">Validation Warnings:</p>
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-yellow-600">
              Row {e.row}: {e.field} - {e.message}
            </p>
          ))}
        </div>
      )}

      <div className="overflow-x-auto mb-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-1 px-2 text-gray-500">#</th>
              <th className="text-left py-1 px-2 text-gray-500">Payer</th>
              <th className="text-right py-1 px-2 text-gray-500">Amount</th>
              <th className="text-right py-1 px-2 text-gray-500">Rate (bps)</th>
              <th className="text-right py-1 px-2 text-gray-500">Due Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-1 px-2 text-gray-400">{i + 1}</td>
                <td className="py-1 px-2 font-mono text-gray-700">{row.payer.slice(0, 12)}...</td>
                <td className="py-1 px-2 text-right text-gray-700">
                  {Number(row.amount) / 10_000_000}
                </td>
                <td className="py-1 px-2 text-right text-gray-700">{row.discountRate}</td>
                <td className="py-1 px-2 text-right text-gray-700">{row.dueDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="px-4 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
        >
          Confirm & Submit
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 border border-gray-300 text-gray-600 text-xs rounded hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function BatchInvoiceForm({ freelancer, onComplete, maxInvoices = 10 }: BatchInvoiceFormProps) {
  const {
    submitBatch,
    batchProgress,
    isPending,
    error,
    reset,
    retryFailed,
    failedInvoices: failedInputs,
  } = useBatchSubmitInvoice();

  const [invoices, setInvoices] = useState<BatchInvoiceInput[]>(() => [
    { freelancer, payer: "", amount: 0n, dueDate: 0, discountRate: 0 },
  ]);
  const [csvPreview, setCsvPreview] = useState<{
    rows: CsvInvoiceRow[];
    errors: CsvValidationError[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (index: number, field: keyof BatchInvoiceInput, value: string) => {
      setInvoices((prev) =>
        prev.map((inv, i) => {
          if (i !== index) return inv;
          switch (field) {
            case "payer":
              return { ...inv, payer: value };
            case "amount":
              return { ...inv, amount: BigInt(Math.round(parseFloat(value || "0") * 10_000_000)) };
            case "discountRate":
              return { ...inv, discountRate: parseInt(value || "0", 10) };
            case "dueDate":
              return { ...inv, dueDate: parseInt(value || "0", 10) };
            default:
              return inv;
          }
        }),
      );
    },
    [],
  );

  const handleRemove = useCallback((index: number) => {
    setInvoices((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAdd = useCallback(() => {
    setInvoices((prev) => [
      ...prev,
      { freelancer, payer: "", amount: 0n, dueDate: 0, discountRate: 0 },
    ]);
  }, [freelancer]);

  const handleSubmit = useCallback(async () => {
    const valid = invoices.filter((inv) => inv.payer.startsWith("G") && inv.amount > 0n);
    if (valid.length === 0) return;

    try {
      const result = await submitBatch(valid.map((inv) => ({ ...inv, freelancer })));
      const succeeded = valid.filter((_, i) => result.results[i]?.success).length;
      const failed = valid.length - succeeded;

      const elapsed = batchProgress ? Math.floor((Date.now() - batchProgress.startedAt) / 1000) : 0;
      const entry: BatchHistoryEntry = {
        id: `batch-${Date.now()}`,
        timestamp: Date.now(),
        totalInvoices: valid.length,
        succeeded,
        failed,
        results: result.results.map((r) => ({
          index: r.index,
          success: r.success,
          error: r.error,
          invoiceId: r.invoiceId,
        })),
        totalFee: result.totalFee.toString(),
        durationMs: elapsed * 1000,
      };
      saveBatchEntry(entry);

      onComplete?.({ succeeded, failed });
    } catch {
      // Error handled by hook
    }
  }, [invoices, freelancer, submitBatch, batchProgress, onComplete]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      const parsed = parseCsv(content);
      setCsvPreview(parsed);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleCsvConfirm = useCallback(() => {
    if (!csvPreview) return;
    const newInvoices: BatchInvoiceInput[] = csvPreview.rows.map((row) => ({
      freelancer,
      payer: row.payer,
      amount: row.amount,
      dueDate: row.dueDate,
      discountRate: row.discountRate,
      token: row.token,
    }));
    setInvoices((prev) => {
      const combined = [...prev, ...newInvoices];
      return combined.slice(0, maxInvoices);
    });
    setCsvPreview(null);
  }, [csvPreview, freelancer, maxInvoices]);

  const isSubmitting = isPending || (batchProgress?.isProcessing ?? false);
  const hasResults = batchProgress?.isComplete ?? false;

  if (hasResults) {
    return (
      <div className="space-y-4">
        <ProgressTracker progress={batchProgress!} />
        <ErrorSummary results={batchProgress!.invoices} />
        <div className="flex gap-2">
          {batchProgress!.failedCount > 0 && (
            <button
              onClick={retryFailed}
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-amber-500 text-white text-xs rounded hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              Retry Failed ({batchProgress!.failedCount})
            </button>
          )}
          <button
            onClick={reset}
            className="px-4 py-1.5 border border-gray-300 text-gray-600 text-xs rounded hover:bg-gray-50 transition-colors"
          >
            New Batch
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Batch Submit Invoices</h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded hover:bg-gray-50 transition-colors"
            aria-label="Import CSV file"
          >
            Import CSV
          </button>
        </div>
      </div>

      {csvPreview && (
        <CsvPreview
          rows={csvPreview.rows}
          errors={csvPreview.errors}
          onConfirm={handleCsvConfirm}
          onCancel={() => setCsvPreview(null)}
        />
      )}

      {isSubmitting && batchProgress && (
        <ProgressTracker progress={batchProgress} />
      )}

      <div className="space-y-2">
        {invoices.map((inv, i) => (
          <InvoiceRowInput
            key={i}
            index={i}
            invoice={inv}
            onChange={handleChange}
            onRemove={handleRemove}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {invoices.length < maxInvoices && (
            <button
              onClick={handleAdd}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded hover:bg-gray-50 transition-colors"
            >
              + Add Invoice
            </button>
          )}
          {invoices.length > 1 && (
            <button
              onClick={() => setInvoices([invoices[0]])}
              className="px-3 py-1.5 border border-gray-300 text-gray-400 text-xs rounded hover:bg-gray-50 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
        <span className="text-xs text-gray-400">{invoices.length}/{maxInvoices}</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-600" role="alert">
          {error.message}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={
          isSubmitting ||
          invoices.filter((inv) => inv.payer.startsWith("G") && inv.amount > 0n).length === 0
        }
        className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting
          ? `Submitting ${batchProgress?.completedCount ?? 0}/${invoices.length}...`
          : `Submit ${invoices.filter((inv) => inv.payer.startsWith("G") && inv.amount > 0n).length} Invoice(s)`}
      </button>
    </div>
  );
}

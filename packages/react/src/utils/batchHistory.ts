export interface BatchHistoryEntry {
  id: string;
  timestamp: number;
  totalInvoices: number;
  succeeded: number;
  failed: number;
  results: Array<{
    index: number;
    success: boolean;
    error?: string;
    invoiceId?: bigint;
  }>;
  totalFee: string;
  durationMs: number;
}

const STORAGE_KEY = 'iln-batch-history';
const MAX_ENTRIES = 50;

export function loadBatchHistory(): BatchHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BatchHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveBatchEntry(entry: BatchHistoryEntry): void {
  if (typeof window === 'undefined') return;
  try {
    const history = loadBatchHistory();
    history.unshift(entry);
    if (history.length > MAX_ENTRIES) {
      history.length = MAX_ENTRIES;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage unavailable
  }
}

export function clearBatchHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function exportBatchResultsAsCsv(entry: BatchHistoryEntry): string {
  const header = 'index,invoice_id,success,error';
  const rows = entry.results.map(
    (r) => `${r.index + 1},${r.invoiceId?.toString() ?? ''},${r.success},"${r.error ?? ''}"`
  );
  return [header, ...rows].join('\n');
}

export function aggregateBatchStats(history: BatchHistoryEntry[]): {
  totalBatches: number;
  totalInvoices: number;
  totalSucceeded: number;
  totalFailed: number;
  successRate: number;
} {
  const totalBatches = history.length;
  const totalInvoices = history.reduce((s, e) => s + e.totalInvoices, 0);
  const totalSucceeded = history.reduce((s, e) => s + e.succeeded, 0);
  const totalFailed = history.reduce((s, e) => s + e.failed, 0);
  const successRate = totalInvoices > 0 ? (totalSucceeded / totalInvoices) * 100 : 0;
  return { totalBatches, totalInvoices, totalSucceeded, totalFailed, successRate };
}

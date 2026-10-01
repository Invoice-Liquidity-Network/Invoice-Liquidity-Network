import { useState, useCallback } from 'react';
import {
  loadBatchHistory,
  clearBatchHistory,
  exportBatchResultsAsCsv,
  aggregateBatchStats,
} from '../utils/batchHistory';
import type { BatchHistoryEntry } from '../utils/batchHistory';

interface BatchHistoryViewProps {
  maxDisplay?: number;
}

export function BatchHistoryView({ maxDisplay = 20 }: BatchHistoryViewProps) {
  const [history, setHistory] = useState<BatchHistoryEntry[]>(() => loadBatchHistory());

  const handleClear = useCallback(() => {
    clearBatchHistory();
    setHistory([]);
  }, []);

  const handleExport = useCallback((entry: BatchHistoryEntry) => {
    const csv = exportBatchResultsAsCsv(entry);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-results-${entry.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportAll = useCallback(() => {
    if (history.length === 0) return;
    const allCsv = history.map((entry) => exportBatchResultsAsCsv(entry)).join('\n\n');
    const blob = new Blob([allCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-batch-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [history]);

  if (history.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
        <p className="text-sm text-gray-400">No batch submissions yet</p>
        <p className="text-xs text-gray-300 mt-1">Batch invoice submissions will appear here</p>
      </div>
    );
  }

  const stats = aggregateBatchStats(history);

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Batch History</h2>
          <div className="flex gap-2">
            <button
              onClick={handleExportAll}
              className="px-3 py-1 border border-gray-300 text-gray-600 text-xs rounded hover:bg-gray-50 transition-colors"
            >
              Export All
            </button>
            <button
              onClick={handleClear}
              className="px-3 py-1 border border-red-200 text-red-500 text-xs rounded hover:bg-red-50 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-800">{stats.totalBatches}</div>
            <div className="text-xs text-gray-400">Batches</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-800">{stats.totalInvoices}</div>
            <div className="text-xs text-gray-400">Invoices</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{stats.totalSucceeded}</div>
            <div className="text-xs text-gray-400">Succeeded</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-500">{stats.totalFailed}</div>
            <div className="text-xs text-gray-400">Failed</div>
          </div>
        </div>

        <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
          <div
            className="h-1.5 rounded-full bg-green-500"
            style={{ width: `${Math.min(stats.successRate, 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1 text-center">
          {stats.successRate.toFixed(1)}% success rate
        </p>
      </div>

      <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
        {history.slice(0, maxDisplay).map((entry) => (
          <div key={entry.id} className="p-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full ${
                    entry.failed > 0 ? 'bg-amber-400' : 'bg-green-400'
                  }`}
                />
                <span className="text-xs text-gray-400">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
                <span className="text-xs text-gray-500">{entry.totalInvoices} invoices</span>
                <span className="text-xs text-green-600 font-medium">{entry.succeeded} ok</span>
                {entry.failed > 0 && (
                  <span className="text-xs text-red-500 font-medium">{entry.failed} failed</span>
                )}
                <span className="text-xs text-gray-300">
                  {(entry.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleExport(entry)}
                  className="px-2 py-0.5 text-[10px] text-gray-400 hover:text-gray-600 border border-gray-200 rounded"
                >
                  CSV
                </button>
              </div>
            </div>
            {entry.failed > 0 && entry.results.some((r) => !r.success && r.error) && (
              <div className="mt-1 ml-5">
                {entry.results
                  .filter((r) => !r.success && r.error)
                  .slice(0, 2)
                  .map((r, i) => (
                    <p key={i} className="text-[10px] text-red-400 truncate">
                      Row {r.index + 1}: {r.error}
                    </p>
                  ))}
                {entry.results.filter((r) => !r.success && r.error).length > 2 && (
                  <p className="text-[10px] text-gray-300">
                    ...and {entry.results.filter((r) => !r.success && r.error).length - 2} more
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

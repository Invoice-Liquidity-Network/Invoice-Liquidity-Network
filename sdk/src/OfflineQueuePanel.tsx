import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { OfflineQueueItem, OfflineState } from "./offline";

export interface OfflineQueueController {
  getState(): OfflineState;
  getQueue(): ReadonlyArray<OfflineQueueItem>;
  onStateChange(callback: (state: OfflineState) => void): () => void;
  processQueue(): Promise<void>;
  retryItem(id: string): Promise<void>;
  removeItem(id: string): boolean;
  clearQueue(): void;
}

export interface OfflineQueuePanelProps {
  manager: OfflineQueueController;
  title?: string;
  className?: string;
}

const EMPTY_STATE: OfflineState = {
  isOnline: true,
  queueSize: 0,
  pendingCount: 0,
  submittingCount: 0,
  failedCount: 0,
  lastSyncTime: null,
};

const STATUS_COLOR: Record<OfflineQueueItem["status"], string> = {
  pending: "#f59e0b",
  submitting: "#2563eb",
  failed: "#dc2626",
  completed: "#16a34a",
};

function formatOperation(operation: string): string {
  return operation
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function OfflineQueuePanel({
  manager,
  title = "Offline Queue",
  className,
}: OfflineQueuePanelProps): React.ReactElement {
  const [state, setState] = useState<OfflineState>(() => manager.getState() ?? EMPTY_STATE);
  const [items, setItems] = useState<ReadonlyArray<OfflineQueueItem>>(() => manager.getQueue());
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setState(manager.getState());
    setItems(manager.getQueue());
  }, [manager]);

  useEffect(() => {
    refresh();
    return manager.onStateChange(() => refresh());
  }, [manager, refresh]);

  const queueLabel = useMemo(() => {
    if (state.queueSize === 0) return "No queued transactions";
    if (state.queueSize === 1) return "1 queued transaction";
    return `${state.queueSize} queued transactions`;
  }, [state.queueSize]);

  async function runAction(actionId: string, action: () => Promise<void> | void) {
    setBusyAction(actionId);
    try {
      await action();
      refresh();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section
      className={className}
      aria-label="Offline transaction queue"
      style={styles.container}
    >
      <header style={styles.header}>
        <div>
          <h2 style={styles.title}>{title}</h2>
          <p style={styles.subtitle}>{queueLabel}</p>
        </div>
        <span
          aria-label={state.isOnline ? "Online" : "Offline"}
          style={{
            ...styles.networkBadge,
            color: state.isOnline ? "#166534" : "#991b1b",
            background: state.isOnline ? "#dcfce7" : "#fee2e2",
          }}
        >
          {state.isOnline ? "Online" : "Offline"}
        </span>
      </header>

      <dl style={styles.stats} aria-label="Queue status">
        <div style={styles.stat}>
          <dt style={styles.statLabel}>Pending</dt>
          <dd style={styles.statValue}>{state.pendingCount}</dd>
        </div>
        <div style={styles.stat}>
          <dt style={styles.statLabel}>Submitting</dt>
          <dd style={styles.statValue}>{state.submittingCount}</dd>
        </div>
        <div style={styles.stat}>
          <dt style={styles.statLabel}>Failed</dt>
          <dd style={styles.statValue}>{state.failedCount}</dd>
        </div>
      </dl>

      <div style={styles.actions}>
        <button
          type="button"
          style={styles.primaryButton}
          onClick={() => runAction("process", () => manager.processQueue())}
          disabled={!state.isOnline || state.queueSize === 0 || busyAction !== null}
        >
          Submit now
        </button>
        <button
          type="button"
          style={styles.secondaryButton}
          onClick={() => runAction("clear", () => manager.clearQueue())}
          disabled={state.queueSize === 0 || busyAction !== null}
        >
          Clear
        </button>
      </div>

      {items.length === 0 ? (
        <div style={styles.empty} role="status">
          Queue is clear
        </div>
      ) : (
        <ul style={styles.list} aria-label="Queued transactions">
          {items.map((item) => (
            <li key={item.id} style={styles.item}>
              <div style={styles.itemMain}>
                <span
                  aria-hidden="true"
                  style={{
                    ...styles.statusDot,
                    background: STATUS_COLOR[item.status],
                  }}
                />
                <div style={styles.itemText}>
                  <strong style={styles.operation}>
                    {formatOperation(item.operation)}
                  </strong>
                  <span style={styles.meta}>
                    {item.status} · {formatDate(item.updatedAt)}
                  </span>
                  {item.error ? <span style={styles.error}>{item.error}</span> : null}
                </div>
              </div>
              <div style={styles.itemActions}>
                {item.status === "failed" ? (
                  <button
                    type="button"
                    style={styles.linkButton}
                    onClick={() => runAction(`retry:${item.id}`, () => manager.retryItem(item.id))}
                    disabled={busyAction !== null || !state.isOnline}
                  >
                    Retry
                  </button>
                ) : null}
                <button
                  type="button"
                  style={styles.linkButton}
                  onClick={() => runAction(`remove:${item.id}`, () => {
                    manager.removeItem(item.id);
                  })}
                  disabled={busyAction !== null}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 720,
    border: "1px solid #dbe3ee",
    borderRadius: 8,
    padding: 16,
    background: "#ffffff",
    color: "#0f172a",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  title: {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.3,
    fontWeight: 700,
  },
  subtitle: {
    margin: "3px 0 0",
    color: "#64748b",
    fontSize: 13,
  },
  networkBadge: {
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
    margin: "0 0 12px",
  },
  stat: {
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "8px 10px",
  },
  statLabel: {
    margin: 0,
    color: "#64748b",
    fontSize: 12,
  },
  statValue: {
    margin: "2px 0 0",
    fontSize: 18,
    fontWeight: 700,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  primaryButton: {
    border: "1px solid #0f172a",
    borderRadius: 6,
    background: "#0f172a",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    padding: "7px 10px",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    padding: "7px 10px",
  },
  empty: {
    border: "1px dashed #cbd5e1",
    borderRadius: 6,
    color: "#64748b",
    fontSize: 13,
    padding: "16px 12px",
    textAlign: "center",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  item: {
    alignItems: "center",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
    padding: 10,
  },
  itemMain: {
    alignItems: "flex-start",
    display: "flex",
    gap: 10,
    minWidth: 0,
  },
  statusDot: {
    borderRadius: "50%",
    flex: "0 0 auto",
    height: 8,
    marginTop: 6,
    width: 8,
  },
  itemText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  operation: {
    fontSize: 14,
    lineHeight: 1.3,
  },
  meta: {
    color: "#64748b",
    fontSize: 12,
  },
  error: {
    color: "#b91c1c",
    fontSize: 12,
    overflowWrap: "anywhere",
  },
  itemActions: {
    display: "flex",
    flex: "0 0 auto",
    gap: 6,
  },
  linkButton: {
    background: "transparent",
    border: "none",
    color: "#1d4ed8",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    padding: "4px 2px",
  },
};

export default OfflineQueuePanel;

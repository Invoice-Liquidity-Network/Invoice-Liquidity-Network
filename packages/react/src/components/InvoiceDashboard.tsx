/**
 * InvoiceDashboard — real-time React component for monitoring invoice activity.
 *
 * Usage:
 *   <InvoiceDashboard websocketUrl="wss://your-iln-node/ws" />
 *
 * Props
 * ─────
 * websocketUrl   WebSocket endpoint that streams LiveInvoiceEvent JSON frames
 * metrics        Which metric cards to show (default: all four)
 * theme          "light" | "dark" | "system" — defaults to system preference
 * refreshMs      Reconnect polling interval ms (default: 10000)
 * maxEvents      Max recent-events rows to keep (default: 50)
 * className      Optional host-element class names
 * onEvent        Callback fired for every incoming event
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ── Public types ───────────────────────────────────────────────────────────

export type InvoiceEventType = "submitted" | "funded" | "paid" | "defaulted";

export interface LiveInvoiceEvent {
  type: InvoiceEventType;
  invoiceId: string;
  amount: string;
  address: string;
  timestamp: number;
}

export interface DashboardMetrics {
  totalSubmitted: number;
  totalFunded: number;
  totalPaid: number;
  totalDefaulted: number;
  recentEvents: LiveInvoiceEvent[];
}

export type MetricKey = keyof Omit<DashboardMetrics, "recentEvents">;

export type DashboardTheme = "light" | "dark" | "system";

export interface InvoiceDashboardProps {
  websocketUrl: string;
  metrics?: MetricKey[];
  theme?: DashboardTheme;
  refreshMs?: number;
  maxEvents?: number;
  className?: string;
  onEvent?: (event: LiveInvoiceEvent) => void;
}

// ── Internals ──────────────────────────────────────────────────────────────

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

const ALL_METRICS: MetricKey[] = [
  "totalSubmitted",
  "totalFunded",
  "totalPaid",
  "totalDefaulted",
];

const METRIC_LABELS: Record<MetricKey, string> = {
  totalSubmitted: "Submitted",
  totalFunded: "Funded",
  totalPaid: "Paid",
  totalDefaulted: "Defaulted",
};

const METRIC_ACCENT: Record<MetricKey, string> = {
  totalSubmitted: "#6366f1",
  totalFunded: "#22c55e",
  totalPaid: "#3b82f6",
  totalDefaulted: "#ef4444",
};

const EVENT_DOT: Record<InvoiceEventType, string> = {
  submitted: "#6366f1",
  funded: "#22c55e",
  paid: "#3b82f6",
  defaulted: "#ef4444",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connecting: "#f59e0b",
  connected: "#22c55e",
  disconnected: "#94a3b8",
  error: "#ef4444",
};

function useResolvedTheme(theme: DashboardTheme): "light" | "dark" {
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    if (theme !== "system") return theme;
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    if (theme !== "system") { setResolved(theme); return; }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) =>
      setResolved(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return resolved;
}

// ── Component ──────────────────────────────────────────────────────────────

export function InvoiceDashboard({
  websocketUrl,
  metrics = ALL_METRICS,
  theme = "system",
  refreshMs = 10_000,
  maxEvents = 50,
  className,
  onEvent,
}: InvoiceDashboardProps) {
  const [state, setState] = useState<DashboardMetrics>({
    totalSubmitted: 0,
    totalFunded: 0,
    totalPaid: 0,
    totalDefaulted: 0,
    recentEvents: [],
  });
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const resolvedTheme = useResolvedTheme(theme);

  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1_000);

  const applyEvent = useCallback(
    (event: LiveInvoiceEvent) => {
      setState((prev) => {
        const key =
          (`total${event.type.charAt(0).toUpperCase()}${event.type.slice(1)}`) as MetricKey;
        return {
          ...prev,
          [key]: (prev[key] as number) + 1,
          recentEvents: [event, ...prev.recentEvents].slice(0, maxEvents),
        };
      });
      onEvent?.(event);
    },
    [onEvent, maxEvents]
  );

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    setStatus("connecting");
    const ws = new WebSocket(websocketUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      retryDelay.current = 1_000;
    };
    ws.onmessage = (msg) => {
      try {
        applyEvent(JSON.parse(msg.data as string) as LiveInvoiceEvent);
      } catch { /* ignore malformed frames */ }
    };
    ws.onerror = () => setStatus("error");
    ws.onclose = () => {
      setStatus("disconnected");
      retryTimer.current = setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
        connect();
      }, retryDelay.current);
    };
  }, [websocketUrl, applyEvent]);

  useEffect(() => {
    connect();
    const poll = setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) connect();
    }, refreshMs);
    return () => {
      clearInterval(poll);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [connect, refreshMs]);

  // ── Styles ────────────────────────────────────────────────────────────

  const isDark = resolvedTheme === "dark";
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const fg = isDark ? "#f1f5f9" : "#0f172a";
  const cardBg = isDark ? "#1e293b" : "#ffffff";
  const border = isDark ? "#1e293b" : "#e2e8f0";
  const muted = isDark ? "#94a3b8" : "#64748b";

  const visibleEvents = useMemo(
    () => state.recentEvents.slice(0, 10),
    [state.recentEvents]
  );

  return (
    <div
      className={className}
      data-theme={resolvedTheme}
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: bg,
        color: fg,
        borderRadius: "12px",
        border: `1px solid ${border}`,
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
          Invoice Activity
        </h2>
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: muted }}
          aria-live="polite"
          aria-label={`Connection status: ${status}`}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: STATUS_DOT[status],
              display: "inline-block",
            }}
          />
          {status}
        </span>
      </div>

      {/* Metric Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: "12px",
          marginBottom: "20px",
        }}
        role="list"
        aria-label="Invoice metrics"
      >
        {metrics.map((key) => (
          <div
            key={key}
            role="listitem"
            style={{
              background: cardBg,
              border: `1px solid ${border}`,
              borderTop: `3px solid ${METRIC_ACCENT[key]}`,
              borderRadius: "8px",
              padding: "14px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 500,
                color: muted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {METRIC_LABELS[key]}
            </div>
            <div
              style={{ fontSize: "24px", fontWeight: 700, marginTop: "6px" }}
              aria-label={`${METRIC_LABELS[key]}: ${state[key]}`}
            >
              {state[key] as number}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Events */}
      <div>
        <div
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: muted,
            marginBottom: "8px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Recent Events
        </div>

        {visibleEvents.length === 0 ? (
          <div
            style={{ color: muted, fontSize: "13px", textAlign: "center", padding: "24px 0" }}
            aria-live="polite"
          >
            Waiting for events…
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
            aria-label="Recent invoice events"
          >
            {visibleEvents.map((ev, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: cardBg,
                  border: `1px solid ${border}`,
                  borderRadius: "6px",
                  padding: "8px 12px",
                  fontSize: "13px",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: EVENT_DOT[ev.type],
                  }}
                  aria-hidden="true"
                />
                <span style={{ fontWeight: 500, textTransform: "capitalize", minWidth: "80px" }}>
                  {ev.type}
                </span>
                <span style={{ color: muted, fontFamily: "monospace", fontSize: "12px" }}>
                  #{ev.invoiceId}
                </span>
                <span style={{ marginLeft: "auto", color: muted, fontSize: "11px" }}>
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default InvoiceDashboard;

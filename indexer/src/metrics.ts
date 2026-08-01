import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

// Central registry for all metrics exported by the indexer.
export const registry = new Registry();

// Collect node/process default metrics with `iln_` prefix.
collectDefaultMetrics({ register: registry, prefix: "iln_" });

export const httpRequestsTotal = new Counter({
  name: "iln_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "iln_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.3, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpErrorsTotal = new Counter({
  name: "iln_http_errors_total",
  help: "Total number of HTTP errors (5xx)",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});

export const dbQueryDuration = new Histogram({
  name: "iln_db_query_duration_seconds",
  help: "Database query duration in seconds",
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
  registers: [registry],
});

export const dbErrorsTotal = new Counter({
  name: "iln_db_errors_total",
  help: "Database errors",
  registers: [registry],
});

export const eventsProcessedTotal = new Counter({
  name: "iln_events_processed_total",
  help: "Number of contract events processed",
  registers: [registry],
});

export const invoicesUpsertedTotal = new Counter({
  name: "iln_invoices_upserted_total",
  help: "Number of invoices upserted into the DB",
  registers: [registry],
});

export const lastProcessedLedger = new Gauge({
  name: "iln_last_processed_ledger",
  help: "Last processed ledger sequence number",
  registers: [registry],
});

export const cursorUpdatedAt = new Gauge({
  name: "iln_cursor_updated_at",
  help: "Timestamp (ms) when cursor was last updated",
  registers: [registry],
});

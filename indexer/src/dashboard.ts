import { getCursorSnapshot } from './db';

/**
 * Dashboard data provenance (#1452)
 * ---------------------------------
 * Every field returned by `GET /v1/dashboard` is labelled in `provenance` with
 * where it comes from and how much it can be trusted:
 *
 *  - `persisted`     read from the persisted `cursor` row; the source of truth for
 *                    sync state, survives restarts, shared by all instances
 *                    using the same database.
 *  - `process`       in-memory counter of *this* process since `uptime.startTime`;
 *                    reset on restart, not aggregated across instances.
 *  - `derived`       computed from other fields at request time.
 *  - `heuristic`     a threshold judgement, not a measurement.
 *  - `not_collected` nothing records this value; it is always 0 and kept only
 *                    for response-shape compatibility. Do not alert on it.
 *
 * Full audit (normal / failed / repeated / stale / interrupted behaviour):
 * docs/indexer/observability-audit.md
 */

export type ProvenanceKind = 'persisted' | 'process' | 'derived' | 'heuristic' | 'not_collected';

export interface FieldProvenance {
  kind: ProvenanceKind;
  source: string;
}

/**
 * Sync state classification:
 *  - `live`          cursor advanced within `staleAfterSeconds`
 *  - `stale`         cursor exists but has not advanced within `staleAfterSeconds`
 *  - `never_synced`  database readable, cursor never written
 *  - `unavailable`   database read failed; sync fields are null because they are unknown
 */
export type SyncStatus = 'live' | 'stale' | 'never_synced' | 'unavailable';

export interface DashboardMetrics {
  /** ISO time this snapshot was computed; the endpoint is not cached (no-store). */
  generatedAt: string;
  sync: SyncMetrics;
  performance: PerformanceMetrics;
  errors: ErrorMetrics;
  uptime: UptimeMetrics;
  provenance: Record<string, FieldProvenance>;
}

export interface SyncMetrics {
  status: SyncStatus;
  lastSyncTime: string | null;
  lastSyncLedger: number | null;
  /**
   * Seconds since the cursor row was last written (wall clock), NOT ledger lag.
   * For ledger lag use the `iln_ledger_lag` Prometheus gauge.
   */
  syncLag: number | null;
  isSyncing: boolean;
  /** Threshold used for `isSyncing` / `status: 'stale'`. */
  staleAfterSeconds: number;
}

/** Cursor older than this is reported as stale (`isSyncing: false`). */
export const SYNC_STALE_AFTER_SECONDS = 30;

export const DASHBOARD_PROVENANCE: Readonly<Record<string, FieldProvenance>> = Object.freeze({
  'sync.status': { kind: 'derived', source: 'cursor row read outcome + staleAfterSeconds' },
  'sync.lastSyncTime': { kind: 'persisted', source: 'cursor table: updated_at' },
  'sync.lastSyncLedger': { kind: 'persisted', source: 'cursor table: last_ledger' },
  'sync.syncLag': { kind: 'derived', source: 'now - cursor.updated_at (seconds, wall clock)' },
  'sync.isSyncing': { kind: 'heuristic', source: 'syncLag < staleAfterSeconds' },
  'performance.requestCount': { kind: 'process', source: 'HTTP responses finished by this process' },
  'performance.averageResponseTime': { kind: 'process', source: 'mean HTTP response time (ms) in this process' },
  'performance.dbQueryCount': { kind: 'not_collected', source: 'none (see iln_db_query_duration_seconds)' },
  'performance.dbQueryAvgTime': { kind: 'not_collected', source: 'none (see iln_db_query_duration_seconds)' },
  'performance.memoryUsage': { kind: 'process', source: 'process.memoryUsage() at request time' },
  'errors.totalErrors': { kind: 'process', source: 'HTTP responses with status >= 400 in this process' },
  'errors.errorRate': { kind: 'derived', source: 'totalErrors / requestCount (includes 4xx)' },
  'errors.lastError': { kind: 'process', source: 'last recorded error, sanitized' },
  'errors.errorsByType': { kind: 'process', source: 'error counts keyed by HTTP status' },
  'uptime.startTime': { kind: 'process', source: 'process metrics start (or last resetMetrics)' },
  'uptime.uptimeSeconds': { kind: 'derived', source: 'now - startTime' },
  'uptime.uptimeFormatted': { kind: 'derived', source: 'uptimeSeconds' },
});

export interface PerformanceMetrics {
  requestCount: number;
  averageResponseTime: number;
  dbQueryCount: number;
  dbQueryAvgTime: number;
  memoryUsage: NodeJS.MemoryUsage;
}

export interface ErrorMetrics {
  totalErrors: number;
  errorRate: number;
  lastError: string | null;
  errorsByType: Record<string, number>;
}

export interface UptimeMetrics {
  startTime: string;
  uptimeSeconds: number;
  uptimeFormatted: string;
}

let startTime = Date.now();
let requestCount = 0;
let totalResponseTime = 0;
// Never written: no code path records DB query counts into the dashboard.
// Kept at 0 for response-shape compatibility and labelled `not_collected`.
const dbQueryCount = 0;
const dbQueryAvgTime = 0;
let errorCount = 0;
let errorsByType: Record<string, number> = {};
let lastError: string | null = null;

export function recordRequest(responseTimeMs: number): void {
  requestCount++;
  totalResponseTime += responseTimeMs;
}

export function recordError(errorType: string, message: string): void {
  errorCount++;
  errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
  // Dashboard metrics are externally readable. Never retain raw exception
  // text because it may contain credentials, connection strings or paths.
  lastError = sanitizeOperationalError(message);
}

export function sanitizeOperationalError(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0];
  return firstLine
    // Full connection strings for known database schemes - drop the whole thing.
    .replace(
      /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|sqlite|amqp):\/\/\S+/gi,
      '[REDACTED_CONNECTION_URL]'
    )
    // user:password@ embedded in any URL (http, https, custom schemes, ...).
    .replace(/([a-z][a-z0-9+.-]*):\/\/([^/\s:@]+):([^/\s@]+)@/gi, '$1://[REDACTED_CREDENTIALS]@')
    // key=value / key: value for well-known secret field names, tolerating
    // JSON-style quoting ("password":"hunter2") around the separator.
    .replace(
      /(api[_-]?key|token|secret|password|passwd|pwd)\s*["']?\s*[=:]\s*["']?[^\s"',}\]\\]+/gi,
      '$1=[REDACTED]'
    )
    // Authorization header values (Bearer/Basic/Digest <credential>).
    .replace(/(Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [REDACTED_AUTH]')
    // AWS-style access key ids.
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
    .replace(/(?:[A-Za-z]:\\|\/(?:home|Users|var|opt|srv)\/)[^\s:]+/g, '[REDACTED_PATH]')
    .slice(0, 240);
}

export function getDashboardMetrics(): DashboardMetrics {
  const now = Date.now();
  const uptimeSeconds = Math.floor((now - startTime) / 1000);

  return {
    generatedAt: new Date(now).toISOString(),
    sync: getSyncMetrics(now),
    performance: {
      requestCount,
      averageResponseTime: requestCount > 0 ? totalResponseTime / requestCount : 0,
      dbQueryCount,
      dbQueryAvgTime,
      memoryUsage: process.memoryUsage(),
    },
    errors: {
      totalErrors: errorCount,
      errorRate: requestCount > 0 ? errorCount / requestCount : 0,
      lastError,
      errorsByType: { ...errorsByType },
    },
    uptime: {
      startTime: new Date(startTime).toISOString(),
      uptimeSeconds,
      uptimeFormatted: formatUptime(uptimeSeconds),
    },
    provenance: { ...DASHBOARD_PROVENANCE },
  };
}

/**
 * Sync state from the persisted cursor row. The dashboard is externally
 * readable, so a failing query degrades to `status: 'unavailable'` with null
 * fields instead of throwing (which would surface an error page + stack trace).
 */
function getSyncMetrics(now: number): SyncMetrics {
  let snapshot: { ledger: number; updatedAt: number } | null;
  try {
    snapshot = getCursorSnapshot();
  } catch {
    return {
      status: 'unavailable',
      lastSyncTime: null,
      lastSyncLedger: null,
      syncLag: null,
      isSyncing: false,
      staleAfterSeconds: SYNC_STALE_AFTER_SECONDS,
    };
  }

  if (snapshot === null) {
    return {
      status: 'never_synced',
      lastSyncTime: null,
      lastSyncLedger: null,
      syncLag: null,
      isSyncing: false,
      staleAfterSeconds: SYNC_STALE_AFTER_SECONDS,
    };
  }

  // A cursor written by a host with a skewed clock can be in the future;
  // report 0 rather than a negative lag.
  const syncLag = Math.max(0, Math.floor((now - snapshot.updatedAt) / 1000));
  const isSyncing = syncLag < SYNC_STALE_AFTER_SECONDS;
  return {
    status: isSyncing ? 'live' : 'stale',
    lastSyncTime: new Date(snapshot.updatedAt).toISOString(),
    lastSyncLedger: snapshot.ledger,
    syncLag,
    isSyncing,
    staleAfterSeconds: SYNC_STALE_AFTER_SECONDS,
  };
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

export function resetMetrics(): void {
  startTime = Date.now();
  requestCount = 0;
  totalResponseTime = 0;
  errorCount = 0;
  errorsByType = {};
  lastError = null;
}

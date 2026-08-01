import { getCursorUpdatedAt, getDb } from './db';

export interface DashboardMetrics {
  sync: SyncMetrics;
  performance: PerformanceMetrics;
  errors: ErrorMetrics;
  uptime: UptimeMetrics;
}

export interface SyncMetrics {
  lastSyncTime: string | null;
  lastSyncLedger: number | null;
  syncLag: number | null;
  isSyncing: boolean;
}

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
let dbQueryCount = 0;
let dbQueryAvgTime = 0;
let errorCount = 0;
let errorsByType: Record<string, number> = {};
let lastError: string | null = null;

export function recordRequest(responseTimeMs: number): void {
  requestCount++;
  totalResponseTime += responseTimeMs;
}

export function recordDbQuery(durationMs: number): void {
  dbQueryCount++;
  dbQueryAvgTime = (dbQueryAvgTime * (dbQueryCount - 1) + durationMs) / dbQueryCount;
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
    .replace(
      /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/\S+/gi,
      '[REDACTED_CONNECTION_URL]'
    )
    .replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/(?:[A-Za-z]:\\|\/(?:home|Users|var|opt|srv)\/)[^\s:]+/g, '[REDACTED_PATH]')
    .slice(0, 240);
}

export function getDashboardMetrics(): DashboardMetrics {
  const now = Date.now();
  const lastSyncMs = getCursorUpdatedAt();
  const uptimeSeconds = Math.floor((now - startTime) / 1000);

  return {
    sync: {
      lastSyncTime: lastSyncMs ? new Date(lastSyncMs).toISOString() : null,
      lastSyncLedger: getLastSyncLedger(),
      syncLag: lastSyncMs ? Math.floor((now - lastSyncMs) / 1000) : null,
      isSyncing: lastSyncMs !== null && now - lastSyncMs < 30000,
    },
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
  };
}

function getLastSyncLedger(): number | null {
  try {
    const db = getDb();
    const row = db.prepare('SELECT last_ledger FROM cursor WHERE id = 1').get() as
      { last_ledger: number } | undefined;
    return row?.last_ledger ?? null;
  } catch {
    return null;
  }
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
  dbQueryCount = 0;
  dbQueryAvgTime = 0;
  errorCount = 0;
  errorsByType = {};
  lastError = null;
}

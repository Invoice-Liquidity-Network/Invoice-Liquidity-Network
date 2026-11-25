import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { createDb, getDb, setCursorLedger, setDb } from '../src/db';
import {
  DASHBOARD_PROVENANCE,
  getDashboardMetrics,
  recordRequest,
  resetMetrics,
  SYNC_STALE_AFTER_SECONDS,
} from '../src/dashboard';

// Dashboard data provenance audit (#1452). See docs/indexer/observability-audit.md.

function setCursorAge(seconds: number): void {
  getDb().prepare('UPDATE cursor SET updated_at = ? WHERE id = 1').run(Date.now() - seconds * 1000);
}

/** Dotted paths of every leaf metric in the payload (memoryUsage/errorsByType are leaves). */
function leafPaths(metrics: ReturnType<typeof getDashboardMetrics>): string[] {
  const paths: string[] = [];
  for (const section of ['sync', 'performance', 'errors', 'uptime'] as const) {
    for (const key of Object.keys(metrics[section])) {
      // staleAfterSeconds is a constant describing the heuristic, not a metric.
      if (section === 'sync' && key === 'staleAfterSeconds') continue;
      paths.push(`${section}.${key}`);
    }
  }
  return paths.sort();
}

beforeEach(() => {
  resetMetrics();
  setDb(createDb(':memory:'));
});

describe('dashboard provenance labels', () => {
  it('labels every metric it returns, and labels nothing it does not return', () => {
    const metrics = getDashboardMetrics();
    expect(Object.keys(metrics.provenance).sort()).toEqual(leafPaths(metrics));
    expect(Object.keys(DASHBOARD_PROVENANCE).sort()).toEqual(leafPaths(metrics));
  });

  it('labels the never-instrumented DB query fields as not_collected, and they stay 0 under load', () => {
    for (let i = 0; i < 5; i++) recordRequest(10);
    const metrics = getDashboardMetrics();
    expect(metrics.performance.requestCount).toBe(5);
    expect(metrics.performance.dbQueryCount).toBe(0);
    expect(metrics.performance.dbQueryAvgTime).toBe(0);
    expect(metrics.provenance['performance.dbQueryCount'].kind).toBe('not_collected');
    expect(metrics.provenance['performance.dbQueryAvgTime'].kind).toBe('not_collected');
  });

  it('marks isSyncing as a heuristic and sync fields as persisted', () => {
    const { provenance } = getDashboardMetrics();
    expect(provenance['sync.isSyncing'].kind).toBe('heuristic');
    expect(provenance['sync.lastSyncLedger'].kind).toBe('persisted');
    expect(provenance['sync.lastSyncTime'].kind).toBe('persisted');
    expect(provenance['performance.requestCount'].kind).toBe('process');
  });
});

describe('dashboard sync state (normal / stale / failed / never synced)', () => {
  it('normal: a fresh cursor is live and reports the persisted ledger', () => {
    setCursorLedger(4242);
    const { sync } = getDashboardMetrics();
    expect(sync.status).toBe('live');
    expect(sync.lastSyncLedger).toBe(4242);
    expect(sync.isSyncing).toBe(true);
    expect(sync.syncLag).toBeLessThan(2);
    expect(sync.staleAfterSeconds).toBe(SYNC_STALE_AFTER_SECONDS);
  });

  it('stale: a cursor older than the threshold is stale and not syncing', () => {
    setCursorLedger(100);
    setCursorAge(SYNC_STALE_AFTER_SECONDS + 30);
    const { sync } = getDashboardMetrics();
    expect(sync.status).toBe('stale');
    expect(sync.isSyncing).toBe(false);
    expect(sync.syncLag).toBeGreaterThanOrEqual(SYNC_STALE_AFTER_SECONDS + 30);
    // The last known values are still reported, labelled by the stale status.
    expect(sync.lastSyncLedger).toBe(100);
  });

  it('never synced: an empty database is distinguishable from a failed read', () => {
    const { sync } = getDashboardMetrics();
    expect(sync.status).toBe('never_synced');
    expect(sync.lastSyncLedger).toBeNull();
    expect(sync.isSyncing).toBe(false);
  });

  it('failed: an unreadable database reports unavailable, not never_synced', () => {
    const db = createDb(':memory:');
    db.close();
    setDb(db);
    const { sync } = getDashboardMetrics();
    expect(sync.status).toBe('unavailable');
    expect(sync.lastSyncTime).toBeNull();
    expect(sync.lastSyncLedger).toBeNull();
    expect(sync.syncLag).toBeNull();
    expect(sync.isSyncing).toBe(false);
  });

  it('adversarial: a cursor timestamp in the future (clock skew) never yields a negative lag', () => {
    setCursorLedger(100);
    setCursorAge(-3600);
    const { sync } = getDashboardMetrics();
    expect(sync.syncLag).toBe(0);
    expect(sync.status).toBe('live');
  });

  it('repeated reads: ledger and time come from the same cursor write', () => {
    setCursorLedger(10);
    const first = getDashboardMetrics().sync;
    setCursorLedger(20);
    const second = getDashboardMetrics().sync;
    expect(first.lastSyncLedger).toBe(10);
    expect(second.lastSyncLedger).toBe(20);
    expect(Date.parse(second.lastSyncTime!)).toBeGreaterThanOrEqual(Date.parse(first.lastSyncTime!));
  });

  it('interrupted: process counters reset on restart while persisted sync state survives', () => {
    setCursorLedger(77);
    recordRequest(5);
    resetMetrics(); // what a process restart does to in-memory counters
    const metrics = getDashboardMetrics();
    expect(metrics.performance.requestCount).toBe(0);
    expect(metrics.sync.lastSyncLedger).toBe(77);
  });
});

describe('GET /v1/dashboard freshness', () => {
  it('is never cached, so a CDN cannot serve a snapshot older than the stale threshold', async () => {
    const res = await request(createApp()).get('/v1/dashboard');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Date.now() - Date.parse(res.body.generatedAt)).toBeLessThan(5_000);
    expect(res.body.provenance['sync.isSyncing'].kind).toBe('heuristic');
  });
});

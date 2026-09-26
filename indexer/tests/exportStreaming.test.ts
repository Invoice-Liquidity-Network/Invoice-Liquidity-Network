/**
 * Resource-exhaustion protections for the streaming/paginated bulk-export
 * path (issue #1042): true row streaming, per-session budgets, graceful
 * mid-stream cutoff with resumption cursors, and bounded job-store growth.
 */
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api';
import { createDb, setDb, getDb } from '../src/db';
import {
  _clearJobs,
  createExportJob,
  decodeExportCursor,
  encodeExportCursor,
  getExportContent,
  getExportJob,
  invoicesToCsv,
  processExportJob,
  queryInvoicesForExport,
  streamInvoicesExport,
  type ExportSink,
} from '../src/export';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const G1 = 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR';

function seedMany(count: number, startId = 1): void {
  const db = getDb();
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO invoices
       (id, freelancer, payer, amount, due_date, discount_rate, status, funder, funded_at, created_at, updated_at)
     VALUES (?, ?, 'GPAYER', '100000000', 9999999999, 300, 'Pending', NULL, NULL, ?, ?)`
  );
  db.transaction(() => {
    for (let id = startId; id < startId + count; id++) {
      insert.run(id, `${G1.slice(0, 40)}${id}`, now, now);
    }
  })();
}

// ─── Env-overridable budget config ───────────────────────────────────────────

const BUDGET_ENVS = [
  'EXPORT_SESSION_MAX_ROWS',
  'EXPORT_SESSION_MAX_SECONDS',
  'EXPORT_SESSION_MAX_BYTES',
  'EXPORT_PAGE_MAX_ROWS',
  'EXPORT_JOB_TTL_SECONDS',
  'EXPORT_JOB_MAX',
] as const;

function setEnv(cases: Record<string, string>): void {
  for (const [k, v] of Object.entries(cases)) process.env[k] = v;
}

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  setDb(createDb(':memory:'));
  _clearJobs();
  saved = {};
  for (const key of BUDGET_ENVS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of BUDGET_ENVS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.useRealTimers();
});

// ─── Byte-exact streaming parity ─────────────────────────────────────────────

describe('streaming output parity with materialized export', () => {
  let app: Express;
  beforeEach(() => {
    seedMany(5);
    app = createApp();
  });

  it('streams CSV byte-identically to invoicesToCsv of the full result set', async () => {
    const res = await request(app).get('/v1/export/invoices?format=csv');
    expect(res.status).toBe(200);
    expect(res.text).toBe(invoicesToCsv(queryInvoicesForExport({})));
  });

  it('streams JSON byte-identically to JSON.stringify(rows, null, 2)', async () => {
    const res = await request(app).get('/v1/export/invoices?format=json');
    expect(res.status).toBe(200);
    expect(res.text).toBe(JSON.stringify(queryInvoicesForExport({}), null, 2));
    expect(res.body).toHaveLength(5);
  });

  it('streams an empty result set as valid JSON and header-only CSV', async () => {
    const empty = await request(app).get('/v1/export/invoices?status=Nope');
    expect(empty.text).toBe('[]');
    const csv = await request(app).get('/v1/export/invoices?format=csv&status=Nope');
    expect(csv.text).toBe(invoicesToCsv([]));
  });
});

// ─── Budget cutoff + resumption round-trip ───────────────────────────────────

describe('session budget cutoff and resumption cursor', () => {
  let app: Express;
  beforeEach(() => {
    seedMany(10);
    app = createApp();
  });

  it('truncates a page at the row budget and the resumed page has no gaps or dupes', async () => {
    setEnv({ EXPORT_PAGE_MAX_ROWS: '4', EXPORT_SESSION_MAX_ROWS: '1000' });

    const page1 = await request(app).get('/v1/export/invoices?format=csv');
    expect(page1.status).toBe(200);
    expect(page1.headers['x-export-truncated']).toBe('true');
    const cursor1 = page1.headers['x-export-resumption-cursor'];
    expect(cursor1).toBeTruthy();
    const rows1 = page1.text.trim().split('\n').slice(1);
    expect(rows1).toHaveLength(4);

    const page2 = await request(app).get(`/v1/export/invoices?format=csv&cursor=${cursor1}`);
    expect(page2.headers['x-export-truncated']).toBe('true');
    const cursor2 = page2.headers['x-export-resumption-cursor'];
    const rows2 = page2.text.trim().split('\n').slice(1);
    expect(rows2).toHaveLength(4);

    const page3 = await request(app).get(`/v1/export/invoices?format=csv&cursor=${cursor2}`);
    expect(page3.headers['x-export-truncated']).toBeUndefined();
    const rows3 = page3.text.trim().split('\n').slice(1);
    expect(rows3).toHaveLength(2);

    const full = await request(app).get('/v1/export/invoices?format=csv');
    // Reassembling the truncated pages must equal one full materialized export.
    setEnv({ EXPORT_PAGE_MAX_ROWS: '1000' });
    const complete = await request(app).get('/v1/export/invoices?format=csv');
    expect([page1.text, page2.text, page3.text].length).toBe(3);
    const header = complete.text.split('\n')[0];
    expect(full.status).toBe(200);
    expect(`${header}\n${[rows1, rows2, rows3].flat().join('\n')}`).toBe(complete.text);
    // The reassembled ids are exactly 1..10 once, in order.
    const ids = [rows1, rows2, rows3].flat().map((r) => Number(r.split(',')[0]));
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('resumption cursor carries cumulative delivered rows so the session budget survives paging', async () => {
    setEnv({ EXPORT_PAGE_MAX_ROWS: '4', EXPORT_SESSION_MAX_ROWS: '6' });

    const page1 = await request(app).get('/v1/export/invoices');
    expect(page1.status).toBe(200);
    const cursor = page1.headers['x-export-resumption-cursor'];
    const decoded = decodeExportCursor(cursor);
    expect(decoded?.id).toBe(4);
    expect(decoded?.rowsBefore).toBe(4);

    // Session budget is 6 rows cumulative, but page 1 already delivered 4.
    // Page 2 delivers the remaining 2 then reports the session as exhausted.
    const page2 = await request(app).get(`/v1/export/invoices?cursor=${cursor}`);
    expect(page2.status).toBe(200);
    expect(page2.headers['x-export-truncated']).toBe('true');
    const decoded2 = decodeExportCursor(page2.headers['x-export-resumption-cursor']);
    expect(decoded2?.id).toBe(6);
    expect(decoded2?.rowsBefore).toBe(6);

    const page3 = await request(
      app
    ).get(`/v1/export/invoices?cursor=${page2.headers['x-export-resumption-cursor']}`);
    expect(page3.status).toBe(413);
    expect(page3.body.error).toContain('budget exhausted');
  });

  it('cuts off after a complete row when the byte budget is exceeded (valid JSON, full rows only)', async () => {
    const oneRowBytes = Buffer.byteLength(JSON.stringify(queryInvoicesForExport({})[0], null, 2), 'utf8');
    setEnv({ EXPORT_SESSION_MAX_BYTES: String(oneRowBytes * 2 + 200) });

    const res = await request(app).get('/v1/export/invoices?format=json');
    expect(res.status).toBe(200);
    expect(res.headers['x-export-truncated']).toBe('true');
    const parsed = JSON.parse(res.text); // must remain valid JSON
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBeLessThan(10);
  });

  it('413 behavior is unchanged for over-limit requests without a cursor', async () => {
    const res = await request(app).get('/v1/export/invoices');
    expect(res.status).toBe(200);
    const { SYNC_EXPORT_LIMIT } = await import('../src/export');
    seedMany(SYNC_EXPORT_LIMIT + 1, 1000);
    const over = await request(app).get('/v1/export/invoices');
    expect(over.status).toBe(413);
    expect(over.body.error).toContain('Result set too large');
    expect(over.body.limit).toBe(SYNC_EXPORT_LIMIT);
  });
});

// ─── Async job budget bookkeeping ────────────────────────────────────────────

describe('async export job budgets', () => {
  let app: Express;
  beforeEach(() => {
    app = createApp();
  });

  it('marks a budget-truncated job and its download response, then resumes into a follow-up job', async () => {
    seedMany(10);
    setEnv({ EXPORT_PAGE_MAX_ROWS: '6', EXPORT_SESSION_MAX_ROWS: '1000' });

    const job = createExportJob('invoices', 'json', {});
    await processExportJob(job.jobId);
    expect(job.status).toBe('done');
    expect(getExportJob(job.jobId)?.truncated).toBe(true);
    const cursor = getExportJob(job.jobId)?.resumptionCursor;
    expect(cursor).toBeTruthy();

    const download = await request(app).get(`/v1/export/download/${job.jobId}`);
    expect(download.headers['x-export-truncated']).toBe('true');
    expect(download.headers['x-export-resumption-cursor']).toBe(cursor);
    expect(JSON.parse(download.text)).toHaveLength(6);

    const resumed = createExportJob('invoices', 'json', { cursor });
    await processExportJob(resumed.jobId);
    const rest = JSON.parse(contentOf(resumed.jobId));
    expect(rest).toHaveLength(4);
    expect(getExportJob(resumed.jobId)?.truncated).toBeFalsy();

    const first = JSON.parse(contentOf(job.jobId));
    const ids = [...first, ...rest].map((r: { id: number }) => r.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('fails a resumed job immediately when the session row budget is already exhausted', async () => {
    seedMany(10);
    setEnv({ EXPORT_SESSION_MAX_ROWS: '5' });
    const exhausted = encodeExportCursor(5, 5);
    const job = createExportJob('invoices', 'json', { cursor: exhausted });
    await processExportJob(job.jobId);
    expect(getExportJob(job.jobId)?.status).toBe('failed');
    expect(getExportJob(job.jobId)?.error).toContain('budget exhausted');
  });
});

function contentOf(jobId: string): string {
  const content = getExportContent(jobId);
  if (content === undefined) throw new Error('content missing');
  return content;
}

// ─── Job store TTL / cap eviction ────────────────────────────────────────────

describe('job store eviction', () => {
  beforeEach(() => {
    seedMany(3);
  });

  it('evicts finished jobs past EXPORT_JOB_TTL_SECONDS', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    setEnv({ EXPORT_JOB_TTL_SECONDS: '10' });

    const job = createExportJob('invoices', 'json', {});
    await processExportJob(job.jobId);
    expect(getExportJob(job.jobId)).toBeDefined();

    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    expect(getExportJob(job.jobId)).toBeUndefined();
    // Eviction also happens on job creation.
    createExportJob('invoices', 'csv', {});
    expect(getExportJob(job.jobId)).toBeUndefined();
  });

  it('caps the job map, keeping the newest entries when over EXPORT_JOB_MAX', async () => {
    setEnv({ EXPORT_JOB_MAX: '3' });
    const jobs = [
      createExportJob('invoices', 'json', {}),
      createExportJob('invoices', 'json', {}),
    ];
    await processExportJob(jobs[0].jobId);
    await processExportJob(jobs[1].jobId);

    const newer: string[] = [];
    for (let i = 0; i < 3; i++) newer.push(createExportJob('invoices', 'json', {}).jobId);

    // Oldest finished job evicted; newest retained.
    expect(getExportJob(jobs[0].jobId)).toBeUndefined();
    for (const id of newer) expect(getExportJob(id)).toBeDefined();
  });

  it('keeps _clearJobs working for test isolation', () => {
    createExportJob('invoices', 'json', {});
    _clearJobs();
    expect(createExportJob('invoices', 'json', {})).toBeDefined();
  });
});

// ─── Statement lifecycle ─────────────────────────────────────────────────────

describe('statement lifecycle under cutoff', () => {
  it('does not leak open statements when the stream is cut off mid-query', () => {
    seedMany(100);
    const chunks: string[] = [];
    const sink: ExportSink = {
      write: (c: string) => chunks.push(c),
      setHeader: () => undefined,
    };
    for (let i = 0; i < 25; i++) {
      streamInvoicesExport(sink, {}, 'csv', { maxRows: 10, maxBytes: 1e9, maxMs: 1e9 });
    }
    // If statements leaked, SQLite refuses to close the connection.
    expect(() => getDb().close()).not.toThrow();
    setDb(createDb(':memory:'));
  });
});

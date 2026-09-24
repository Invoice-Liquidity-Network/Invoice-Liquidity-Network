import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { createDb, setDb, upsertInvoice, insertEvent } from '../src/db';
import { _clearJobs, invoicesToCsv, eventsToCsv } from '../src/export';
import type { ILNEvent } from '../src/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const G1 = 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR';
const G2 = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';
const G3 = 'GDNA2SBLDTGZICXNPQ5SIQFYBDP7WGLXSLKQFQYQRXLWSMQWMFWVHP2';

function seedInvoice(id: number, overrides: Partial<Parameters<typeof upsertInvoice>[0]> = {}) {
  upsertInvoice({
    id,
    freelancer: G1,
    payer: G2,
    amount: '100000000',
    due_date: 9_999_999_999,
    discount_rate: 300,
    status: 'Pending',
    funder: null,
    funded_at: null,
    ...overrides,
  });
}

function seedEvent(overrides: Partial<ILNEvent> = {}) {
  insertEvent({
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    event_type: 'submitted',
    invoice_id: 1,
    ledger: 1000,
    ledger_closed_at: new Date().toISOString(),
    created_at: Date.now(),
    ...overrides,
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let app: Express;

beforeEach(() => {
  setDb(createDb(':memory:'));
  _clearJobs();
  app = createApp();

  seedInvoice(1, { status: 'Pending' });
  seedInvoice(2, { status: 'Funded', funder: G3, funded_at: 1_700_000_000 });
  seedInvoice(3, { status: 'Paid', funder: G3 });

  seedEvent({ event_id: 'evt-001', event_type: 'submitted', invoice_id: 1, ledger: 100 });
  seedEvent({ event_id: 'evt-002', event_type: 'funded', invoice_id: 2, ledger: 200 });
  seedEvent({ event_id: 'evt-003', event_type: 'paid', invoice_id: 3, ledger: 300 });
});

// ── GET /v1/export/invoices — JSON ────────────────────────────────────────────

describe('GET /v1/export/invoices (JSON)', () => {
  it('returns all invoices as a JSON array by default', async () => {
    const res = await request(app).get('/v1/export/invoices');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
  });

  it('includes required invoice fields', async () => {
    const res = await request(app).get('/v1/export/invoices');
    const inv = res.body[0];
    expect(inv).toHaveProperty('id');
    expect(inv).toHaveProperty('freelancer');
    expect(inv).toHaveProperty('payer');
    expect(inv).toHaveProperty('amount');
    expect(inv).toHaveProperty('status');
  });

  it('filters by status', async () => {
    const res = await request(app).get('/v1/export/invoices?status=Pending');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('Pending');
  });

  it('filters by freelancer', async () => {
    const res = await request(app).get(`/v1/export/invoices?freelancer=${G1}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it('filters by funder', async () => {
    const res = await request(app).get(`/v1/export/invoices?funder=${G3}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    res.body.forEach((inv: any) => expect(inv.funder).toBe(G3));
  });

  it('date range filter from=past includes all current rows', async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const res = await request(app).get(`/v1/export/invoices?from=${from}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it('date range filter to=past excludes all current rows', async () => {
    const to = new Date(Date.now() - 60_000).toISOString();
    const res = await request(app).get(`/v1/export/invoices?to=${to}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('combined from+to range works', async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const res = await request(app).get(`/v1/export/invoices?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it('returns 400 for malformed from date', async () => {
    const res = await request(app).get('/v1/export/invoices?from=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for malformed to date', async () => {
    const res = await request(app).get('/v1/export/invoices?to=baddate');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('sets Content-Disposition attachment header', async () => {
    const res = await request(app).get('/v1/export/invoices?format=json');
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/invoices\.json/);
  });
});

// ── GET /v1/export/invoices — CSV ─────────────────────────────────────────────

describe('GET /v1/export/invoices (CSV)', () => {
  it('returns CSV text with correct content-type', async () => {
    const res = await request(app).get('/v1/export/invoices?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('first line is the CSV header', async () => {
    const res = await request(app).get('/v1/export/invoices?format=csv');
    const firstLine = (res.text as string).split('\n')[0];
    expect(firstLine).toBe(
      'id,freelancer,payer,amount,due_date,discount_rate,status,funder,funded_at,created_at,updated_at'
    );
  });

  it('has one data row per invoice', async () => {
    const res = await request(app).get('/v1/export/invoices?format=csv');
    const lines = (res.text as string).trim().split('\n');
    // 1 header + 3 data rows
    expect(lines).toHaveLength(4);
  });

  it('sets Content-Disposition attachment header for CSV', async () => {
    const res = await request(app).get('/v1/export/invoices?format=csv');
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/invoices\.csv/);
  });

  it('filters by status in CSV', async () => {
    const res = await request(app).get('/v1/export/invoices?format=csv&status=Paid');
    const lines = (res.text as string).trim().split('\n');
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain('Paid');
  });
});

// ── GET /v1/export/events — JSON ──────────────────────────────────────────────

describe('GET /v1/export/events (JSON)', () => {
  it('returns all events as a JSON array', async () => {
    const res = await request(app).get('/v1/export/events');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
  });

  it('filters by invoiceId', async () => {
    const res = await request(app).get('/v1/export/events?invoiceId=1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].invoice_id).toBe(1);
  });

  it('date filter from=past includes all current events', async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const res = await request(app).get(`/v1/export/events?from=${from}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it('date filter to=past excludes all current events', async () => {
    const to = new Date(Date.now() - 60_000).toISOString();
    const res = await request(app).get(`/v1/export/events?to=${to}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns 400 for invalid from date', async () => {
    const res = await request(app).get('/v1/export/events?from=nope');
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/export/events — CSV ───────────────────────────────────────────────

describe('GET /v1/export/events (CSV)', () => {
  it('returns CSV with correct content-type', async () => {
    const res = await request(app).get('/v1/export/events?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('first line is the CSV header', async () => {
    const res = await request(app).get('/v1/export/events?format=csv');
    const firstLine = (res.text as string).split('\n')[0];
    expect(firstLine).toBe('event_id,event_type,invoice_id,ledger,ledger_closed_at,created_at');
  });

  it('has one data row per event', async () => {
    const res = await request(app).get('/v1/export/events?format=csv');
    const lines = (res.text as string).trim().split('\n');
    expect(lines).toHaveLength(4); // header + 3 data rows
  });

  it('sets Content-Disposition attachment header', async () => {
    const res = await request(app).get('/v1/export/events?format=csv');
    expect(res.headers['content-disposition']).toMatch(/events\.csv/);
  });
});

// ── POST /v1/export/jobs — async export ───────────────────────────────────────

describe('POST /v1/export/jobs', () => {
  it('creates a job and returns 202 with jobId and downloadUrl', async () => {
    const res = await request(app)
      .post('/v1/export/jobs')
      .send({ type: 'invoices', format: 'json' });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.status).toBe('pending');
    expect(res.body.downloadUrl).toMatch(/\/v1\/export\/download\//);
  });

  it('creates a CSV invoice job', async () => {
    const res = await request(app)
      .post('/v1/export/jobs')
      .send({ type: 'invoices', format: 'csv' });

    expect(res.status).toBe(202);
    expect(res.body.format).toBe('csv');
    expect(res.body.type).toBe('invoices');
  });

  it('creates an event export job', async () => {
    const res = await request(app).post('/v1/export/jobs').send({ type: 'events', format: 'json' });

    expect(res.status).toBe(202);
    expect(res.body.type).toBe('events');
  });

  it('returns 400 for invalid type', async () => {
    const res = await request(app)
      .post('/v1/export/jobs')
      .send({ type: 'wallets', format: 'json' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/v1/export/jobs')
      .send({ type: 'invoices', format: 'xml' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for malformed from date', async () => {
    const res = await request(app)
      .post('/v1/export/jobs')
      .send({ type: 'invoices', format: 'json', from: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  it('accepts date range filters in the job body', async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const res = await request(app)
      .post('/v1/export/jobs')
      .send({ type: 'invoices', format: 'json', from, to });
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
  });
});


// ── GET /v1/export/jobs/:jobId — status polling ───────────────────────────────

describe('GET /v1/export/jobs/:jobId', () => {
  it('enforces ASYNC_EXPORT_LIMIT and fails the job when the dataset is too large', async () => {
    const { processExportJob: process, createExportJob: create, ASYNC_EXPORT_LIMIT } = await import('../src/export');
    
    // We mock countInvoicesForExport to return a huge number to simulate an oversized result
    const exportModule = await import('../src/export');
    const originalCount = exportModule.countInvoicesForExport;
    (exportModule as any).countInvoicesForExport = () => ASYNC_EXPORT_LIMIT + 1;

    try {
      const job = create('invoices', 'json', {});
      await process(job.jobId);

      const res = await request(app).get(`/v1/export/jobs/${job.jobId}`);
      expect(res.body.status).toBe('failed');
      expect(res.body.error).toContain('Result set too large');
    } finally {
      (exportModule as any).countInvoicesForExport = originalCount;
    }
  });

  it('returns the job status after creation', async () => {

    const createRes = await request(app)
      .post('/v1/export/jobs')
      .send({ type: 'invoices', format: 'json' });

    const { jobId } = createRes.body;
    const res = await request(app).get(`/v1/export/jobs/${jobId}`);

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(jobId);
    expect(['pending', 'processing', 'done']).toContain(res.body.status);
  });

  it('returns 404 for an unknown job ID', async () => {
    const res = await request(app).get('/v1/export/jobs/non-existent-id');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('includes downloadUrl once done', async () => {
    const { processExportJob: process, createExportJob: create } = await import('../src/export');

    const job = create('invoices', 'json', {});
    await process(job.jobId);

    const res = await request(app).get(`/v1/export/jobs/${job.jobId}`);
    expect(res.body.status).toBe('done');
    expect(res.body.downloadUrl).toMatch(job.jobId);
    expect(typeof res.body.rowCount).toBe('number');
  });

  it('shows null downloadUrl while job is pending', async () => {
    const createRes = await request(app)
      .post('/v1/export/jobs')
      .send({ type: 'invoices', format: 'csv' });

    const { jobId } = createRes.body;
    // Immediately poll — may still be pending/processing
    const res = await request(app).get(`/v1/export/jobs/${jobId}`);
    expect(res.status).toBe(200);
    // downloadUrl is null unless done
    if (res.body.status !== 'done') {
      expect(res.body.downloadUrl).toBeNull();
    }
  });
});

// ── GET /v1/export/download/:jobId — file download ───────────────────────────

describe('GET /v1/export/download/:jobId', () => {
  it('serves a completed JSON invoice export', async () => {
    const { processExportJob: process, createExportJob: create } = await import('../src/export');

    const job = create('invoices', 'json', {});
    await process(job.jobId);

    const res = await request(app).get(`/v1/export/download/${job.jobId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(/invoices\.json/);
    expect(Array.isArray(JSON.parse(res.text))).toBe(true);
  });

  it('serves a completed CSV invoice export', async () => {
    const { processExportJob: process, createExportJob: create } = await import('../src/export');

    const job = create('invoices', 'csv', {});
    await process(job.jobId);

    const res = await request(app).get(`/v1/export/download/${job.jobId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const firstLine = res.text.split('\n')[0];
    expect(firstLine).toContain('freelancer');
  });

  it('serves a completed JSON events export', async () => {
    const { processExportJob: process, createExportJob: create } = await import('../src/export');

    const job = create('events', 'json', {});
    await process(job.jobId);

    const res = await request(app).get(`/v1/export/download/${job.jobId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(JSON.parse(res.text))).toBe(true);
  });

  it('returns 202 when job is still processing', async () => {
    const { createExportJob: create, getExportJob } = await import('../src/export');

    const job = create('invoices', 'json', {});
    // Do NOT process — leave it in pending state
    const current = getExportJob(job.jobId);
    if (current) current.status = 'processing';

    const res = await request(app).get(`/v1/export/download/${job.jobId}`);
    expect(res.status).toBe(202);
  });

  it('returns 404 for unknown job ID', async () => {
    const res = await request(app).get('/v1/export/download/no-such-job');
    expect(res.status).toBe(404);
  });
});

// ── CSV unit helpers ──────────────────────────────────────────────────────────

describe('invoicesToCsv', () => {
  it('produces a header-only CSV for an empty array', () => {
    const csv = invoicesToCsv([]);
    expect(csv).toBe(
      'id,freelancer,payer,amount,due_date,discount_rate,status,funder,funded_at,created_at,updated_at'
    );
  });

  it('encodes null funder and funded_at as empty strings', () => {
    const csv = invoicesToCsv([
      {
        id: 1,
        freelancer: G1,
        payer: G2,
        amount: '100',
        due_date: 9999,
        discount_rate: 300,
        status: 'Pending',
        funder: null,
        funded_at: null,
        created_at: 1_700_000_000,
        updated_at: 1_700_000_000,
      },
    ]);
    const row = csv.split('\n')[1]!;
    const fields = row.split(',');
    // funder is index 7, funded_at is index 8
    expect(fields[7]).toBe('');
    expect(fields[8]).toBe('');
  });

  it('escapes fields containing commas in double quotes', () => {
    const csv = invoicesToCsv([
      {
        id: 1,
        freelancer: 'addr,with,comma',
        payer: G2,
        amount: '100',
        due_date: 9999,
        discount_rate: 0,
        status: 'Pending',
        funder: null,
        funded_at: null,
        created_at: 0,
        updated_at: 0,
      },
    ]);
    expect(csv).toContain('"addr,with,comma"');
  });
});

describe('eventsToCsv', () => {
  it('produces a header-only CSV for an empty array', () => {
    const csv = eventsToCsv([]);
    expect(csv).toBe('event_id,event_type,invoice_id,ledger,ledger_closed_at,created_at');
  });

  it('produces one data row per event', () => {
    const csv = eventsToCsv([
      {
        event_id: 'evt-001',
        event_type: 'submitted',
        invoice_id: 1,
        ledger: 100,
        ledger_closed_at: '2024-01-01T00:00:00Z',
        created_at: 1_700_000_000,
      },
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('evt-001');
    expect(lines[1]).toContain('submitted');
  });
});

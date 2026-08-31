import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { createDb, setDb, upsertInvoice, setCursorLedger } from '../src/db';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const G1 = 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR'; // freelancer 1
const G2 = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S'; // payer
const G3 = 'GDNA2SBLDTGZICXNPQ5SIQFYBDP7WGLXSLKQFQYQRXLWSMQWMFWVHP2'; // funder
const G4 = 'GAOJJQB6RJQJKPQBZ7DFRHLKKSMAFUNP3MK5Y6UFSRCFCYUQ5VXALOE'; // freelancer 2

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

// ── Setup ─────────────────────────────────────────────────────────────────────

let app: Express;

beforeEach(() => {
  setDb(createDb(':memory:'));
  app = createApp();

  // Seed a variety of invoices
  seedInvoice(1, { status: 'Pending', freelancer: G1 });
  seedInvoice(2, { status: 'Funded', freelancer: G1, funder: G3, funded_at: 1_700_000_000 });
  seedInvoice(3, { status: 'Paid', freelancer: G4, funder: G3 });
  seedInvoice(4, { status: 'Pending', freelancer: G4 });
  seedInvoice(5, { status: 'Defaulted', freelancer: G4 });
});

// ── GET /v1/health ────────────────────────────────────────────────────────────

describe('GET /v1/health', () => {
  it('returns 200 with all required fields', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('db');
    expect(res.body).toHaveProperty('lastSync');
    expect(res.body).toHaveProperty('uptime');
  });

  it('reports status ok and db ok when database is healthy', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
  });

  it('returns null lastSync when the indexer has never synced', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.body.lastSync).toBeNull();
  });

  it('returns an ISO 8601 lastSync timestamp after a ledger is processed', async () => {
    setCursorLedger(12345);
    const res = await request(app).get('/v1/health');
    expect(res.body.lastSync).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns a non-negative uptime in milliseconds', async () => {
    const res = await request(app).get('/v1/health');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ── GET /v1/invoices (unfiltered) ─────────────────────────────────────────────

describe('GET /v1/invoices', () => {
  it('returns all invoices', async () => {
    const res = await request(app).get('/v1/invoices');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(5);
  });

  it('returns invoices as an array', async () => {
    const res = await request(app).get('/v1/invoices');
    expect(Array.isArray(res.body.invoices)).toBe(true);
  });

  it('each invoice has required fields', async () => {
    const res = await request(app).get('/v1/invoices');
    const inv = res.body.invoices[0];
    expect(inv).toHaveProperty('id');
    expect(inv).toHaveProperty('status');
    expect(inv).toHaveProperty('freelancer');
    expect(inv).toHaveProperty('payer');
    expect(inv).toHaveProperty('amount');
  });
});

describe('GET /v1/stats', () => {
  it('returns protocol-level analytics', async () => {
    const res = await request(app).get('/v1/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalInvoices: 5,
      totalVolume: '500000000',
      totalYield: '3000000',
      defaultRate: 0.5,
    });
  });
});

describe('GET /v1/lps/:address/stats', () => {
  it('returns LP deployment, yield, invoice count, and default rate', async () => {
    const res = await request(app).get(`/v1/lps/${G3}/stats`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      deployed: '200000000',
      yield: '3000000',
      invoiceCount: 2,
      defaultRate: 0,
    });
  });
});

describe('GET /v1/freelancers/:address/stats', () => {
  it('returns freelancer submission and payout stats', async () => {
    const res = await request(app).get(`/v1/freelancers/${G1}/stats`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      submitted: 2,
      funded: 1,
      totalReceived: '97000000',
      avgDiscount: 300,
    });
  });
});

describe('GET /v1/history/:address', () => {
  it('returns invoice history for a supported role', async () => {
    const res = await request(app).get(`/v1/history/${G3}?role=funder`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    res.body.forEach((inv: any) => expect(inv.funder).toBe(G3));
  });

  it('rejects unsupported roles', async () => {
    const res = await request(app).get(`/v1/history/${G3}?role=admin`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /v1/lps/top', () => {
  it('returns LPs sorted by realized yield', async () => {
    const res = await request(app).get('/v1/lps/top?limit=5&period=all');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        address: G3,
        yield: '3000000',
        invoiceCount: 2,
      },
    ]);
  });

  it('rejects unsupported periods', async () => {
    const res = await request(app).get('/v1/lps/top?period=year');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ── GET /v1/invoices?status ───────────────────────────────────────────────────

describe('GET /v1/invoices?status', () => {
  it('filters by Pending', async () => {
    const res = await request(app).get('/v1/invoices?status=Pending');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(2);
    res.body.invoices.forEach((inv: any) => expect(inv.status).toBe('Pending'));
  });

  it('filters by Funded', async () => {
    const res = await request(app).get('/v1/invoices?status=Funded');
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].id).toBe(2);
  });

  it('filters by Paid', async () => {
    const res = await request(app).get('/v1/invoices?status=Paid');
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].id).toBe(3);
  });

  it('filters by Defaulted', async () => {
    const res = await request(app).get('/v1/invoices?status=Defaulted');
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].status).toBe('Defaulted');
  });

  it('returns empty array for unknown status', async () => {
    const res = await request(app).get('/v1/invoices?status=Unknown');
    expect(res.body.invoices).toHaveLength(0);
  });
});

// ── GET /v1/invoices?freelancer ──────────────────────────────────────────────

describe('GET /v1/invoices?freelancer', () => {
  it('filters by freelancer address', async () => {
    const res = await request(app).get(`/v1/invoices?freelancer=${G1}`);
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(2);
    res.body.invoices.forEach((inv: any) => expect(inv.freelancer).toBe(G1));
  });

  it('returns empty array when no invoices match freelancer', async () => {
    const res = await request(app).get('/v1/invoices?freelancer=GNOTEXIST');
    expect(res.body.invoices).toHaveLength(0);
  });
});

// ── GET /v1/invoices?payer ───────────────────────────────────────────────────

describe('GET /v1/invoices?payer', () => {
  it('filters by payer address', async () => {
    const res = await request(app).get(`/v1/invoices?payer=${G2}`);
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(5);
    res.body.invoices.forEach((inv: any) => expect(inv.payer).toBe(G2));
  });
});

// ── GET /v1/invoices?funder ──────────────────────────────────────────────────

describe('GET /v1/invoices?funder', () => {
  it('filters by funder address', async () => {
    const res = await request(app).get(`/v1/invoices?funder=${G3}`);
    expect(res.body.invoices).toHaveLength(2);
    res.body.invoices.forEach((inv: any) => expect(inv.funder).toBe(G3));
  });
});

// ── GET /v1/invoices — combined filters ──────────────────────────────────────

describe('GET /v1/invoices — combined filters', () => {
  it('ANDs status and freelancer', async () => {
    const res = await request(app).get(`/v1/invoices?status=Pending&freelancer=${G4}`);
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].id).toBe(4);
  });

  it('ANDs status and funder', async () => {
    const res = await request(app).get(`/v1/invoices?status=Paid&funder=${G3}`);
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].id).toBe(3);
  });
});

// ── GET /v1/invoice/:id ───────────────────────────────────────────────────────

describe('GET /v1/invoice/:id', () => {
  it('returns the correct invoice for a known ID', async () => {
    const res = await request(app).get('/v1/invoice/2');
    expect(res.status).toBe(200);
    expect(res.body.invoice.id).toBe(2);
    expect(res.body.invoice.status).toBe('Funded');
    expect(res.body.invoice.funder).toBe(G3);
  });

  it('returns 404 for an unknown ID', async () => {
    const res = await request(app).get('/v1/invoice/999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for a non-numeric ID', async () => {
    const res = await request(app).get('/v1/invoice/abc');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for id = 0', async () => {
    const res = await request(app).get('/v1/invoice/0');
    expect(res.status).toBe(400);
  });
});

// ── Versioning headers ────────────────────────────────────────────────────────

describe('v1 versioning headers', () => {
  it('GET /v1/health includes API-Version: 1 header', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.headers['api-version']).toBe('1');
  });

  it('GET /v1/invoices includes API-Version: 1 header', async () => {
    const res = await request(app).get('/v1/invoices');
    expect(res.headers['api-version']).toBe('1');
  });

  it('GET /v1/invoice/:id includes API-Version: 1 header', async () => {
    const res = await request(app).get('/v1/invoice/1');
    expect(res.headers['api-version']).toBe('1');
  });
});

// ── Backward compat / deprecation headers ────────────────────────────────────

describe('backward compat deprecation headers', () => {
  it('GET /health still returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('GET /health returns Deprecation: true header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['deprecation']).toBe('true');
  });

  it('GET /health returns a Sunset header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['sunset']).toBeDefined();
  });

  it('GET /invoices returns Deprecation: true header', async () => {
    const res = await request(app).get('/invoices');
    expect(res.headers['deprecation']).toBe('true');
  });

  it('version negotiation via Accept header sets API-Version response header', async () => {
    const res = await request(app).get('/invoices').set('Accept', 'application/vnd.iln.v1+json');
    expect(res.headers['api-version']).toBe('1');
  });

  it('version negotiation via API-Version request header sets API-Version response header', async () => {
    const res = await request(app).get('/invoices').set('API-Version', '1');
    expect(res.headers['api-version']).toBe('1');
  });
});

import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { createDb, setDb, upsertInvoice } from '../src/db';

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

// ── /health ───────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// ── GET /invoices (unfiltered) ─────────────────────────────────────────────────

describe('GET /invoices', () => {
  it('returns all invoices', async () => {
    const res = await request(app).get('/invoices');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(5);
  });

  it('returns invoices as an array', async () => {
    const res = await request(app).get('/invoices');
    expect(Array.isArray(res.body.invoices)).toBe(true);
  });

  it('each invoice has required fields', async () => {
    const res = await request(app).get('/invoices');
    const inv = res.body.invoices[0];
    expect(inv).toHaveProperty('id');
    expect(inv).toHaveProperty('status');
    expect(inv).toHaveProperty('freelancer');
    expect(inv).toHaveProperty('payer');
    expect(inv).toHaveProperty('amount');
  });
});

describe('GET /stats', () => {
  it('returns protocol-level analytics', async () => {
    const res = await request(app).get('/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalInvoices: 5,
      totalVolume: '500000000',
      totalYield: '3000000',
      defaultRate: 0.5,
    });
  });
});

describe('GET /lps/:address/stats', () => {
  it('returns LP deployment, yield, invoice count, and default rate', async () => {
    const res = await request(app).get(`/lps/${G3}/stats`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      deployed: '200000000',
      yield: '3000000',
      invoiceCount: 2,
      defaultRate: 0,
    });
  });
});

describe('GET /freelancers/:address/stats', () => {
  it('returns freelancer submission and payout stats', async () => {
    const res = await request(app).get(`/freelancers/${G1}/stats`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      submitted: 2,
      funded: 1,
      totalReceived: '97000000',
      avgDiscount: 300,
    });
  });
});

describe('GET /history/:address', () => {
  it('returns invoice history for a supported role', async () => {
    const res = await request(app).get(`/history/${G3}?role=funder`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    res.body.forEach((inv: any) => expect(inv.funder).toBe(G3));
  });

  it('rejects unsupported roles', async () => {
    const res = await request(app).get(`/history/${G3}?role=admin`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /lps/top', () => {
  it('returns LPs sorted by realized yield', async () => {
    const res = await request(app).get('/lps/top?limit=5&period=all');
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
    const res = await request(app).get('/lps/top?period=year');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ── GET /invoices?status ───────────────────────────────────────────────────────

describe('GET /invoices?status', () => {
  it('filters by Pending', async () => {
    const res = await request(app).get('/invoices?status=Pending');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(2);
    res.body.invoices.forEach((inv: any) => expect(inv.status).toBe('Pending'));
  });

  it('filters by Funded', async () => {
    const res = await request(app).get('/invoices?status=Funded');
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].id).toBe(2);
  });

  it('filters by Paid', async () => {
    const res = await request(app).get('/invoices?status=Paid');
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].id).toBe(3);
  });

  it('filters by Defaulted', async () => {
    const res = await request(app).get('/invoices?status=Defaulted');
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].status).toBe('Defaulted');
  });

  it('returns empty array for unknown status', async () => {
    const res = await request(app).get('/invoices?status=Unknown');
    expect(res.body.invoices).toHaveLength(0);
  });
});

// ── GET /invoices?freelancer ──────────────────────────────────────────────────

describe('GET /invoices?freelancer', () => {
  it('filters by freelancer address', async () => {
    const res = await request(app).get(`/invoices?freelancer=${G1}`);
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(2);
    res.body.invoices.forEach((inv: any) => expect(inv.freelancer).toBe(G1));
  });

  it('returns empty array when no invoices match freelancer', async () => {
    const res = await request(app).get('/invoices?freelancer=GNOTEXIST');
    expect(res.body.invoices).toHaveLength(0);
  });
});

// ── GET /invoices?payer ───────────────────────────────────────────────────────

describe('GET /invoices?payer', () => {
  it('filters by payer address', async () => {
    const res = await request(app).get(`/invoices?payer=${G2}`);
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(5);
    res.body.invoices.forEach((inv: any) => expect(inv.payer).toBe(G2));
  });
});

// ── GET /invoices?funder ──────────────────────────────────────────────────────

describe('GET /invoices?funder', () => {
  it('filters by funder address', async () => {
    const res = await request(app).get(`/invoices?funder=${G3}`);
    expect(res.body.invoices).toHaveLength(2);
    res.body.invoices.forEach((inv: any) => expect(inv.funder).toBe(G3));
  });
});

// ── GET /invoices — combined filters ─────────────────────────────────────────

describe('GET /invoices — combined filters', () => {
  it('ANDs status and freelancer', async () => {
    const res = await request(app).get(`/invoices?status=Pending&freelancer=${G4}`);
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].id).toBe(4);
  });

  it('ANDs status and funder', async () => {
    const res = await request(app).get(`/invoices?status=Paid&funder=${G3}`);
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].id).toBe(3);
  });
});

// ── GET /invoice/:id ──────────────────────────────────────────────────────────

describe('GET /invoice/:id', () => {
  it('returns the correct invoice for a known ID', async () => {
    const res = await request(app).get('/invoice/2');
    expect(res.status).toBe(200);
    expect(res.body.invoice.id).toBe(2);
    expect(res.body.invoice.status).toBe('Funded');
    expect(res.body.invoice.funder).toBe(G3);
  });

  it('returns 404 for an unknown ID', async () => {
    const res = await request(app).get('/invoice/999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for a non-numeric ID', async () => {
    const res = await request(app).get('/invoice/abc');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for id = 0', async () => {
    const res = await request(app).get('/invoice/0');
    expect(res.status).toBe(400);
  });
});

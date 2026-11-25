import { readFileSync } from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import { join } from 'node:path';
import type { Express } from 'express';
import type { OpenAPIV3 } from 'openapi-types';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { createDb, setCursorLedger, setDb, upsertInvoice } from '../src/db';
import { INVOICE_STATUSES, openApiSpec } from '../src/openapi';

// OpenAPI ↔ runtime conformance (#1455): every response below is produced by
// the real Express app and validated against the schema the spec publishes.
// See docs/indexer/observability-audit.md.

// ── Minimal OpenAPI 3.0 schema validator (subset used by src/openapi.ts) ─────

type Schema = OpenAPIV3.SchemaObject;

function validate(schema: Schema, value: unknown, path = '$'): string[] {
  if (value === null) {
    return schema.nullable ? [] : [`${path}: null is not allowed`];
  }
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => validate(s as Schema, value, path));
    return results.some((r) => r.length === 0) ? [] : [`${path}: matches no anyOf branch (${results[0].join('; ')})`];
  }
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected object`];
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${path}.${key}: required`);
      }
      for (const [key, child] of Object.entries(record)) {
        const prop = schema.properties?.[key] as Schema | undefined;
        if (prop) errors.push(...validate(prop, child, `${path}.${key}`));
        else if (typeof schema.additionalProperties === 'object') {
          errors.push(...validate(schema.additionalProperties as Schema, child, `${path}.${key}`));
        }
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) return [`${path}: expected array`];
      value.forEach((item, i) => errors.push(...validate(schema.items as Schema, item, `${path}[${i}]`)));
      break;
    case 'string':
      if (typeof value !== 'string') return [`${path}: expected string, got ${typeof value}`];
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
      }
      if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
        errors.push(`${path}: not a date-time`);
      }
      break;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: expected ${schema.type}`];
      if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected integer, got ${value}`);
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      break;
  }
  return errors;
}

function responseSchema(path: string, status: number, method: 'get' | 'post' = 'get'): Schema {
  const op = openApiSpec.paths[path]?.[method] as OpenAPIV3.OperationObject | undefined;
  const response = op?.responses[String(status)] as OpenAPIV3.ResponseObject | undefined;
  const schema = response?.content?.['application/json']?.schema as Schema | undefined;
  if (!schema) throw new Error(`spec has no JSON schema for ${method.toUpperCase()} ${path} ${status}`);
  return schema;
}

function expectConforms(path: string, res: request.Response, method: 'get' | 'post' = 'get') {
  expect(validate(responseSchema(path, res.status, method), res.body)).toEqual([]);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Real 56-character account ids, so the StellarAddress pattern is exercised.
const account = (n: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)).publicKey();
const G1 = account(1);
const G2 = account(2);
const G3 = account(3);

// Above Number.MAX_SAFE_INTEGER (2^53 - 1) and odd, so a float sum is visibly wrong.
const HUGE = '9007199254740993';

function seed(id: number, overrides: Partial<Parameters<typeof upsertInvoice>[0]> = {}) {
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

let app: Express;

beforeEach(() => {
  setDb(createDb(':memory:'));
  app = createApp();
  seed(1);
  seed(2, { status: 'Funded', funder: G3, funded_at: 1_700_000_000 });
  seed(3, { status: 'Paid', funder: G3, amount: HUGE });
  seed(4, { status: 'Paid', funder: G3, amount: '2' });
  seed(5, { status: 'Disputed', funder: G3 });
});

// ── Static drift checks ───────────────────────────────────────────────────────

describe('spec ↔ source drift', () => {
  it('InvoiceStatus enum lists exactly the statuses in src/types.ts', () => {
    const types = readFileSync(join(__dirname, '../src/types.ts'), 'utf8');
    const block = types.slice(types.indexOf('export type InvoiceStatus'), types.indexOf(';', types.indexOf('export type InvoiceStatus')));
    const statuses = [...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect([...INVOICE_STATUSES].sort()).toEqual(statuses.sort());
  });

  it('every versioned router route is documented', () => {
    const api = readFileSync(join(__dirname, '../src/api.ts'), 'utf8');
    const routes = [...api.matchAll(/router\.(get|post)\('([^']+)'/g)].map(
      ([, method, path]) => `${method.toUpperCase()} ${path.replace(/:(\w+)/g, '{$1}')}`
    );
    const documented = new Set(
      Object.entries(openApiSpec.paths).flatMap(([path, item]) =>
        Object.keys(item ?? {}).map((method) => `${method.toUpperCase()} ${path}`)
      )
    );
    expect(routes.filter((r) => !documented.has(r))).toEqual([]);
  });
});

// ── Runtime conformance ───────────────────────────────────────────────────────

describe('freshness fields', () => {
  it('/health 200 conforms', async () => {
    setCursorLedger(10);
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expectConforms('/health', res);
  });

  it('/health 503 is documented and conforms (status "error", not "degraded")', async () => {
    const db = createDb(':memory:');
    db.close();
    setDb(db);
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expectConforms('/health', res);
  });

  it('/dashboard conforms when never synced and when live', async () => {
    let res = await request(app).get('/v1/dashboard');
    expectConforms('/dashboard', res);
    setCursorLedger(10);
    res = await request(app).get('/v1/dashboard');
    expect(res.body.sync.status).toBe('live');
    expectConforms('/dashboard', res);
  });
});

describe('pagination', () => {
  it('nextCursor is present while hasMore and omitted on the last page', async () => {
    const first = await request(app).get('/v1/invoices?limit=3');
    expectConforms('/invoices', first);
    expect(first.body.hasMore).toBe(true);
    expect(typeof first.body.nextCursor).toBe('string');

    const last = await request(app).get(`/v1/invoices?limit=3&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expectConforms('/invoices', last);
    expect(last.body.hasMore).toBe(false);
    expect('nextCursor' in last.body).toBe(false);
    expect(last.body.invoices.map((i: { id: number }) => i.id)).toEqual([4, 5]);
  });

  it('adversarial: an unparseable cursor restarts from the first page (documented)', async () => {
    const res = await request(app).get('/v1/invoices?limit=2&cursor=%%%not-base64');
    expectConforms('/invoices', res);
    expect(res.body.invoices[0].id).toBe(1);
  });

  it('every on-chain status round-trips through the Invoice schema', async () => {
    const res = await request(app).get('/v1/invoice/5');
    expect(res.body.invoice.status).toBe('Disputed');
    expectConforms('/invoice/{id}', res);
  });
});

describe('financial values', () => {
  it('/stats sums above 2^53 are exact base-10 strings', async () => {
    const res = await request(app).get('/v1/stats');
    expectConforms('/stats', res);
    const expected = 100000000n * 3n + BigInt(HUGE) + 2n;
    expect(res.body.totalVolume).toBe(expected.toString());
    expect(res.body.totalYield).toBe(((BigInt(HUGE) * 300n) / 10000n + (2n * 300n) / 10000n).toString());
  });

  it('/lps/{address}/stats, /lps/top and /freelancers/{address}/stats conform and are exact', async () => {
    const lp = await request(app).get(`/v1/lps/${G3}/stats`);
    expectConforms('/lps/{address}/stats', lp);
    expect(lp.body.deployed).toBe((100000000n * 2n + BigInt(HUGE) + 2n).toString());

    const top = await request(app).get('/v1/lps/top');
    expectConforms('/lps/top', top);

    const fl = await request(app).get(`/v1/freelancers/${G1}/stats`);
    expectConforms('/freelancers/{address}/stats', fl);
    expect(fl.body.totalReceived).toMatch(/^[0-9]+$/);
  });

  it('/history with a field projection conforms', async () => {
    const res = await request(app).get(`/v1/history/${G1}?fields=id,amount,bogus`);
    expectConforms('/history/{address}', res);
    expect(Object.keys(res.body[0]).sort()).toEqual(['amount', 'id']);
  });
});

describe('errors', () => {
  it('400 and 404 bodies conform to ErrorResponse', async () => {
    const bad = await request(app).get('/v1/invoice/abc');
    expect(bad.status).toBe(400);
    expectConforms('/invoice/{id}', bad);

    const missing = await request(app).get('/v1/invoice/999');
    expect(missing.status).toBe(404);
    expectConforms('/invoice/{id}', missing);

    const period = await request(app).get('/v1/lps/top?period=year');
    expect(period.status).toBe(400);
    expectConforms('/lps/top', period);
  });
});

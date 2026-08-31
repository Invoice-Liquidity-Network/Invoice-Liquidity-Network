import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api';
import { createDb, setDb, upsertInvoice, insertEvent, getDb } from '../src/db';
import {
  archiveOldData,
  queryArchiveInvoices,
  queryArchiveEvents,
  restoreInvoice,
  getArchiveStats,
} from '../src/archive';

const G1 = 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR';
const G2 = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';

let app: Express;

beforeEach(() => {
  // Use in-memory database for testing the archive
  process.env.ARCHIVE_DB_PATH = ':memory:';
  setDb(createDb(':memory:'));
  app = createApp();
});

afterEach(() => {
  delete process.env.ARCHIVE_DB_PATH;
});

describe('Indexer Database Archival', () => {
  it('archives records older than 90 days, queries them, and restores them successfully', () => {
    const now = Date.now();
    const hundredDaysAgo = now - 100 * 24 * 60 * 60 * 1000;
    const activeDb = getDb();

    // 1. Seed two invoices
    // Invoice 1 (will be archived)
    upsertInvoice({
      id: 1,
      freelancer: G1,
      payer: G2,
      amount: '15000',
      due_date: Math.floor(now / 1000) + 86400,
      discount_rate: 300,
      status: 'Pending',
      funder: null,
      funded_at: null,
    });
    // Manually force created_at back to 100 days ago
    activeDb.prepare('UPDATE invoices SET created_at = ? WHERE id = 1').run(hundredDaysAgo);

    // Invoice 2 (should remain in main DB)
    upsertInvoice({
      id: 2,
      freelancer: G1,
      payer: G2,
      amount: '25000',
      due_date: Math.floor(now / 1000) + 86400,
      discount_rate: 300,
      status: 'Pending',
      funder: null,
      funded_at: null,
    });

    // 2. Seed events
    // Event 1 (will be archived)
    insertEvent({
      event_id: 'evt_1',
      event_type: 'submitted',
      invoice_id: 1,
      ledger: 100,
      ledger_closed_at: new Date(hundredDaysAgo).toISOString(),
      created_at: hundredDaysAgo,
    });

    // Event 2 (should remain in main DB)
    insertEvent({
      event_id: 'evt_2',
      event_type: 'submitted',
      invoice_id: 2,
      ledger: 200,
      ledger_closed_at: new Date(now).toISOString(),
      created_at: now,
    });

    // Verify initial counts in main DB
    const mainInvoicesInit = activeDb
      .prepare('SELECT COUNT(*) as count FROM main.invoices')
      .get() as { count: number };
    expect(mainInvoicesInit.count).toBe(2);

    // 3. Trigger archival for records older than 90 days
    const result = archiveOldData(90);
    expect(result.invoicesMoved).toBe(1);
    expect(result.eventsMoved).toBe(1);

    // 4. Verify main database contents (only invoice 2 / event 2 should remain)
    const mainInvoicesAfter = activeDb.prepare('SELECT * FROM main.invoices').all();
    expect(mainInvoicesAfter).toHaveLength(1);
    expect(mainInvoicesAfter[0].id).toBe(2);

    const mainEventsAfter = activeDb.prepare('SELECT * FROM main.events').all();
    expect(mainEventsAfter).toHaveLength(1);
    expect(mainEventsAfter[0].event_id).toBe('evt_2');

    // 5. Verify archive database contents
    const archivedInvoices = queryArchiveInvoices({});
    expect(archivedInvoices).toHaveLength(1);
    expect(archivedInvoices[0].id).toBe(1);

    const archivedEvents = queryArchiveEvents(1);
    expect(archivedEvents).toHaveLength(1);
    expect(archivedEvents[0].event_id).toBe('evt_1');

    // 6. Verify archive statistics
    const stats = getArchiveStats();
    expect(stats.totalArchivedInvoices).toBe(1);
    expect(stats.totalArchivedEvents).toBe(1);
    expect(stats.archivedVolume).toBe('15000');
    expect(stats.lastArchivedAt).toBeGreaterThan(0);

    // 7. Test restoration
    const restoreSuccess = restoreInvoice(1);
    expect(restoreSuccess).toBe(true);

    // Verify record is back in main DB
    const mainInvoicesFinal = activeDb.prepare('SELECT * FROM main.invoices ORDER BY id ASC').all();
    expect(mainInvoicesFinal).toHaveLength(2);
    expect(mainInvoicesFinal[0].id).toBe(1);

    // Verify record is deleted from archive
    expect(queryArchiveInvoices({})).toHaveLength(0);
    expect(queryArchiveEvents(1)).toHaveLength(0);
  });

  it('handles restoration of non-existent record gracefully', () => {
    const success = restoreInvoice(999);
    expect(success).toBe(false);
  });

  it('exposes REST endpoints for archive operations', async () => {
    // Test GET /v1/archive/stats
    const statsRes = await request(app).get('/v1/archive/stats');
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.totalArchivedInvoices).toBe(0);

    // Test GET /v1/archive/invoices
    const invoicesRes = await request(app).get('/v1/archive/invoices');
    expect(invoicesRes.status).toBe(200);
    expect(invoicesRes.body.invoices).toHaveLength(0);

    // Test GET /v1/archive/events
    const eventsRes = await request(app).get('/v1/archive/events');
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.events).toHaveLength(0);

    // Test POST /v1/archive/run
    const runRes = await request(app).post('/v1/archive/run').send({ olderThanDays: 90 });
    expect(runRes.status).toBe(200);
    expect(runRes.body.success).toBe(true);
    expect(runRes.body.invoicesMoved).toBe(0);

    // Test POST /v1/archive/restore/:id with invalid ID
    const restoreResInvalid = await request(app).post('/v1/archive/restore/abc');
    expect(restoreResInvalid.status).toBe(400);

    // Test POST /v1/archive/restore/:id with non-existent ID
    const restoreRes404 = await request(app).post('/v1/archive/restore/999');
    expect(restoreRes404.status).toBe(404);
  });
});

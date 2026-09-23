import { getDb, type InvoiceFilter } from './db';
import type { Invoice, ILNEvent } from './types';

let archiveAttached = false;

/**
 * Return the database connection with the archive database attached.
 * Configured via process.env.ARCHIVE_DB_PATH (defaults to "archive.db").
 */
export function getArchiveDbConnection() {
  const db = getDb();
  if (!archiveAttached) {
    const archivePath = process.env.ARCHIVE_DB_PATH || 'archive.db';

    // Attach the archive database file
    db.prepare(`ATTACH DATABASE ? AS archive`).run(archivePath);

    // Initialize the archive tables if they don't already exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS archive.invoices (
        id            INTEGER PRIMARY KEY,
        freelancer    TEXT    NOT NULL,
        payer         TEXT    NOT NULL,
        amount        TEXT    NOT NULL,
        due_date      INTEGER NOT NULL,
        discount_rate INTEGER NOT NULL,
        status        TEXT    NOT NULL DEFAULT 'Pending',
        funder        TEXT,
        funded_at     INTEGER,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS archive.events (
        event_id         TEXT    PRIMARY KEY,
        event_type       TEXT    NOT NULL,
        invoice_id       INTEGER NOT NULL,
        ledger           INTEGER NOT NULL,
        ledger_closed_at TEXT    NOT NULL,
        created_at       INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_archive_invoices_created_at ON archive.invoices(created_at);
      CREATE INDEX IF NOT EXISTS idx_archive_invoices_status ON archive.invoices(status);
      CREATE INDEX IF NOT EXISTS idx_archive_events_invoice_id ON archive.events(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_archive_events_created_at ON archive.events(created_at);

      CREATE TABLE IF NOT EXISTS archive.archive_runs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        run_time      INTEGER NOT NULL,
        invoices_moved INTEGER NOT NULL,
        events_moved   INTEGER NOT NULL
      );
    `);

    archiveAttached = true;
  }
  return db;
}

/**
 * Archive invoices and events older than the specified retention threshold (in days).
 * Moves eligible rows to the attached archive database and deletes them from the main database
 * within a single atomic transaction.
 */
export function archiveOldData(olderThanDays: number = 90): {
  invoicesMoved: number;
  eventsMoved: number;
} {
  const db = getArchiveDbConnection();
  const thresholdMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const txn = db.transaction(() => {
    // 1. Calculate how many records will be moved
    const invoicesToMove = db
      .prepare('SELECT COUNT(*) as count FROM main.invoices WHERE created_at < ?')
      .get(thresholdMs) as { count: number };
    const eventsToMove = db
      .prepare('SELECT COUNT(*) as count FROM main.events WHERE created_at < ?')
      .get(thresholdMs) as { count: number };

    if (invoicesToMove.count === 0 && eventsToMove.count === 0) {
      return { invoicesMoved: 0, eventsMoved: 0 };
    }

    // 2. Insert records into the archive database
    db.prepare(
      `
      INSERT OR REPLACE INTO archive.invoices
      SELECT * FROM main.invoices WHERE created_at < ?
    `
    ).run(thresholdMs);

    db.prepare(
      `
      INSERT OR REPLACE INTO archive.events
      SELECT * FROM main.events WHERE created_at < ?
    `
    ).run(thresholdMs);

    // 3. Delete records from the main database
    db.prepare('DELETE FROM main.invoices WHERE created_at < ?').run(thresholdMs);
    db.prepare('DELETE FROM main.events WHERE created_at < ?').run(thresholdMs);

    // 4. Log the archival run
    db.prepare(
      `
      INSERT INTO archive.archive_runs (run_time, invoices_moved, events_moved)
      VALUES (?, ?, ?)
    `
    ).run(Date.now(), invoicesToMove.count, eventsToMove.count);

    return {
      invoicesMoved: invoicesToMove.count,
      eventsMoved: eventsToMove.count,
    };
  });

  return txn();
}

/**
 * Query the archived invoices using filters similar to active database queries.
 */
export function queryArchiveInvoices(filter: InvoiceFilter): Invoice[] {
  const db = getArchiveDbConnection();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  if (filter.freelancer) {
    clauses.push('freelancer = ?');
    params.push(filter.freelancer);
  }
  if (filter.payer) {
    clauses.push('payer = ?');
    params.push(filter.payer);
  }
  if (filter.funder) {
    clauses.push('funder = ?');
    params.push(filter.funder);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM archive.invoices ${where} ORDER BY id ASC`)
    .all(...params) as Invoice[];
}

/**
 * Query the archived events, optionally filtered by invoice_id.
 */
export function queryArchiveEvents(invoiceId?: number): ILNEvent[] {
  const db = getArchiveDbConnection();
  if (invoiceId !== undefined) {
    return db
      .prepare('SELECT * FROM archive.events WHERE invoice_id = ? ORDER BY ledger ASC')
      .all(invoiceId) as ILNEvent[];
  }
  return db
    .prepare('SELECT * FROM archive.events ORDER BY ledger ASC LIMIT 1000')
    .all() as ILNEvent[];
}

/**
 * Restore an invoice and its associated events from the archive database back to the main database.
 */
export function restoreInvoice(id: number): boolean {
  const db = getArchiveDbConnection();

  const txn = db.transaction(() => {
    // Check if the invoice exists in the archive database
    const invoice = db.prepare('SELECT * FROM archive.invoices WHERE id = ?').get(id) as
      | Invoice
      | undefined;
    if (!invoice) {
      return false;
    }

    // 1. Insert invoice back into main database
    db.prepare(
      `
      INSERT OR REPLACE INTO main.invoices
      SELECT * FROM archive.invoices WHERE id = ?
    `
    ).run(id);

    // 2. Insert associated events back into main database
    db.prepare(
      `
      INSERT OR REPLACE INTO main.events
      SELECT * FROM archive.events WHERE invoice_id = ?
    `
    ).run(id);

    // 3. Delete from archive database
    db.prepare('DELETE FROM archive.invoices WHERE id = ?').run(id);
    db.prepare('DELETE FROM archive.events WHERE invoice_id = ?').run(id);

    return true;
  });

  return txn();
}

export interface ArchiveStats {
  totalArchivedInvoices: number;
  totalArchivedEvents: number;
  lastArchivedAt: number | null;
  archivedVolume: string;
}

/**
 * Fetch statistics summarizing the state of the archived data.
 */
export function getArchiveStats(): ArchiveStats {
  const db = getArchiveDbConnection();

  const invoicesCount = db.prepare('SELECT COUNT(*) as count FROM archive.invoices').get() as {
    count: number;
  };
  const eventsCount = db.prepare('SELECT COUNT(*) as count FROM archive.events').get() as {
    count: number;
  };

  const lastRun = db
    .prepare('SELECT run_time FROM archive.archive_runs ORDER BY id DESC LIMIT 1')
    .get() as { run_time: number } | undefined;

  const volumeRow = db
    .prepare('SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total FROM archive.invoices')
    .get() as { total: number };

  return {
    totalArchivedInvoices: invoicesCount.count,
    totalArchivedEvents: eventsCount.count,
    lastArchivedAt: lastRun?.run_time ?? null,
    archivedVolume: volumeRow.total.toString(),
  };
}

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Start the background archival scheduling loop.
 */
export function startArchivalScheduler(intervalMs = 86400000, olderThanDays = 90) {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  // Run once immediately on startup
  try {
    const res = archiveOldData(olderThanDays);
    if (res.invoicesMoved > 0 || res.eventsMoved > 0) {
      console.log(
        `[archive] Automatic archive run completed. Archived ${res.invoicesMoved} invoices and ${res.eventsMoved} events.`
      );
    }
  } catch (err: any) {
    console.error(`[archive] Automatic archive run failed: ${err.message}`);
  }

  // Schedule periodic runs
  schedulerInterval = setInterval(() => {
    try {
      const res = archiveOldData(olderThanDays);
      if (res.invoicesMoved > 0 || res.eventsMoved > 0) {
        console.log(
          `[archive] Automatic archive run completed. Archived ${res.invoicesMoved} invoices and ${res.eventsMoved} events.`
        );
      }
    } catch (err: any) {
      console.error(`[archive] Automatic archive run failed: ${err.message}`);
    }
  }, intervalMs);
}

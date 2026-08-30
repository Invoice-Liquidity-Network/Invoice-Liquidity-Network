import { randomUUID } from 'crypto';
import { getDb, type InvoiceFilter } from './db';
import type { Invoice, ILNEvent } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum rows served synchronously. Requests exceeding this must use async jobs. */
export const SYNC_EXPORT_LIMIT = 5_000;

/** Maximum rows allowed in an async export job to prevent memory exhaustion. */
export const ASYNC_EXPORT_LIMIT = 50_000;


// ─── Filter types ─────────────────────────────────────────────────────────────

export interface ExportFilter extends InvoiceFilter {
  /** ISO 8601 date/datetime — include rows with created_at >= this value. */
  from?: string;
  /** ISO 8601 date/datetime — include rows with created_at <= this value. */
  to?: string;
}

export interface EventExportFilter {
  invoiceId?: number;
  from?: string;
  to?: string;
}

// ─── Job types ────────────────────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'json';
export type ExportType = 'invoices' | 'events';
export type ExportStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface ExportJob {
  jobId: string;
  type: ExportType;
  format: ExportFormat;
  status: ExportStatus;
  filter: ExportFilter | EventExportFilter;
  createdAt: number;
  completedAt?: number;
  rowCount?: number;
  error?: string;
}

// ─── In-memory job store ──────────────────────────────────────────────────────

interface JobEntry {
  job: ExportJob;
  content?: string;
}

const _jobs = new Map<string, JobEntry>();

export function createExportJob(
  type: ExportType,
  format: ExportFormat,
  filter: ExportFilter | EventExportFilter
): ExportJob {
  const jobId = randomUUID();
  const job: ExportJob = {
    jobId,
    type,
    format,
    status: 'pending',
    filter,
    createdAt: Date.now(),
  };
  _jobs.set(jobId, { job });
  return job;
}

export function getExportJob(jobId: string): ExportJob | undefined {
  return _jobs.get(jobId)?.job;
}

export function getExportContent(jobId: string): string | undefined {
  return _jobs.get(jobId)?.content;
}

/** Clear all jobs — used in tests only. */
export function _clearJobs(): void {
  _jobs.clear();
}

// ─── Async job processing ─────────────────────────────────────────────────────

export async function processExportJob(jobId: string): Promise<void> {
  const entry = _jobs.get(jobId);
  if (!entry) return;

  entry.job.status = 'processing';

  try {
    let content: string;
    let rowCount: number;

    if (entry.job.type === 'invoices') {
      const count = countInvoicesForExport(entry.job.filter as ExportFilter);
      if (count > ASYNC_EXPORT_LIMIT) {
        throw new Error(`Result set too large (${count} rows). Maximum allowed for async export is ${ASYNC_EXPORT_LIMIT}.`);
      }
      const rows = queryInvoicesForExport(entry.job.filter as ExportFilter);
      rowCount = rows.length;
      content = entry.job.format === 'csv' ? invoicesToCsv(rows) : JSON.stringify(rows, null, 2);
    } else {
      const count = countEventsForExport(entry.job.filter as EventExportFilter);
      if (count > ASYNC_EXPORT_LIMIT) {
        throw new Error(`Result set too large (${count} rows). Maximum allowed for async export is ${ASYNC_EXPORT_LIMIT}.`);
      }
      const rows = queryEventsForExport(entry.job.filter as EventExportFilter);
      rowCount = rows.length;
      content = entry.job.format === 'csv' ? eventsToCsv(rows) : JSON.stringify(rows, null, 2);
    }

    entry.job.status = 'done';
    entry.job.completedAt = Date.now();
    entry.job.rowCount = rowCount;
    entry.content = content;
  } catch (err) {
    entry.job.status = 'failed';
    entry.job.error = err instanceof Error ? err.message : 'Unknown error';
  }
}

// ─── Sync count helpers ───────────────────────────────────────────────────────

export function countInvoicesForExport(filter: ExportFilter): number {
  const { clauses, params } = buildInvoiceClauses(filter);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = getDb()
    .prepare(`SELECT COUNT(*) as count FROM invoices ${where}`)
    .get(...params) as { count: number };
  return result.count;
}

export function countEventsForExport(filter: EventExportFilter): number {
  const { clauses, params } = buildEventClauses(filter);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = getDb()
    .prepare(`SELECT COUNT(*) as count FROM events ${where}`)
    .get(...params) as { count: number };
  return result.count;
}

// ─── Data queries ─────────────────────────────────────────────────────────────

export function queryInvoicesForExport(filter: ExportFilter): Invoice[] {
  const { clauses, params } = buildInvoiceClauses(filter);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM invoices ${where} ORDER BY id ASC`)
    .all(...params) as Invoice[];
}

export function queryEventsForExport(filter: EventExportFilter): ILNEvent[] {
  const { clauses, params } = buildEventClauses(filter);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM events ${where} ORDER BY ledger ASC`)
    .all(...params) as ILNEvent[];
}

// ─── Clause builders ──────────────────────────────────────────────────────────

function buildInvoiceClauses(filter: ExportFilter): {
  clauses: string[];
  params: (string | number)[];
} {
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
  if (filter.from) {
    clauses.push('created_at >= ?');
    params.push(new Date(filter.from).getTime());
  }
  if (filter.to) {
    clauses.push('created_at <= ?');
    params.push(new Date(filter.to).getTime());
  }

  return { clauses, params };
}

function buildEventClauses(filter: EventExportFilter): {
  clauses: string[];
  params: (string | number)[];
} {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.invoiceId !== undefined) {
    clauses.push('invoice_id = ?');
    params.push(filter.invoiceId);
  }
  if (filter.from) {
    clauses.push('created_at >= ?');
    params.push(new Date(filter.from).getTime());
  }
  if (filter.to) {
    clauses.push('created_at <= ?');
    params.push(new Date(filter.to).getTime());
  }

  return { clauses, params };
}

// ─── CSV serializers ──────────────────────────────────────────────────────────

const INVOICE_CSV_HEADER =
  'id,freelancer,payer,amount,due_date,discount_rate,status,funder,funded_at,created_at,updated_at';

export function invoicesToCsv(invoices: Invoice[]): string {
  const rows = invoices.map((inv) =>
    [
      inv.id,
      csvEscape(inv.freelancer),
      csvEscape(inv.payer),
      csvEscape(inv.amount),
      inv.due_date,
      inv.discount_rate,
      csvEscape(inv.status),
      inv.funder !== null ? csvEscape(inv.funder) : '',
      inv.funded_at !== null ? inv.funded_at : '',
      inv.created_at,
      inv.updated_at,
    ].join(',')
  );
  return [INVOICE_CSV_HEADER, ...rows].join('\n');
}

const EVENT_CSV_HEADER = 'event_id,event_type,invoice_id,ledger,ledger_closed_at,created_at';

export function eventsToCsv(events: ILNEvent[]): string {
  const rows = events.map((evt) =>
    [
      csvEscape(evt.event_id),
      csvEscape(evt.event_type),
      evt.invoice_id,
      evt.ledger,
      csvEscape(evt.ledger_closed_at),
      evt.created_at,
    ].join(',')
  );
  return [EVENT_CSV_HEADER, ...rows].join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

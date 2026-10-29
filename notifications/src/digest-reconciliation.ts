/**
 * Digest reconciliation against invoice events (#1282)
 *
 * The digest buffer used to live only in memory, so a restart lost pending
 * items, replayed events or repeated scheduler passes duplicated lines, and
 * nothing tied a digest line back to the event that justified it.
 *
 * Before every digest is sent, SqliteDigestReconciler checks the candidate
 * items against the persisted `events` and `invoices` tables:
 *
 *   - duplicates        same event id more than once        → dropped
 *   - alreadyDelivered  event id in digest_deliveries       → dropped
 *   - orphaned          chain event id not in `events`      → dropped
 *   - mismatched        event exists but invoice / type / recipient differ → dropped
 *   - backfilled        event in the window for this recipient but never
 *                       buffered (crash, restart)           → added
 *   - unresolved        event in the window whose invoice was never stored
 *                       → reported; the watermark stays before it so the
 *                         next reconcile retries it
 *
 * Every run emits one `[digest-reconcile]` JSON log line and updates the
 * counters served at GET /metrics/digest-reconciliation.
 */

import { getDb } from './db';
import { EVENT_TO_TRIGGER, getNotificationTargets } from './targets';
import type { DigestReconciler, DigestUserConfig } from './digest';
import type { DigestItem } from './templates/digest.template';
import type { ILNEventType, Invoice } from './types';

const CHAIN_EVENT_TYPES = new Set<string>(['submitted', 'funded', 'paid', 'defaulted']);

export interface DigestReconciliationReport {
  stellarAddress: string;
  windowStart: number;
  windowEnd: number;
  kept: number;
  backfilled: number;
  duplicates: number;
  alreadyDelivered: number;
  orphaned: number;
  mismatched: number;
  unresolved: number;
}

type DiscrepancyKey = Exclude<
  keyof DigestReconciliationReport,
  'stellarAddress' | 'windowStart' | 'windowEnd' | 'kept'
>;

interface EventRow {
  event_id: string;
  event_type: ILNEventType;
  invoice_id: number;
  created_at: number;
}

interface StateRow {
  stellar_address: string;
  config: string;
  registered_at: number;
  last_flushed_at: number | null;
}

// ── Metrics ────────────────────────────────────────────────────────────────

const metrics = {
  runs: 0,
  failures: 0,
  totals: {
    backfilled: 0,
    duplicates: 0,
    alreadyDelivered: 0,
    orphaned: 0,
    mismatched: 0,
    unresolved: 0,
  } as Record<DiscrepancyKey, number>,
  lastRunAt: null as number | null,
  lastReport: null as DigestReconciliationReport | null,
};

export function getDigestReconciliationMetrics() {
  return {
    control: 'digest-reconciliation-against-invoice-events',
    runs: metrics.runs,
    failures: metrics.failures,
    totals: { ...metrics.totals },
    lastRunAt: metrics.lastRunAt,
    lastReport: metrics.lastReport,
  };
}

export function resetDigestReconciliationMetrics(): void {
  metrics.runs = 0;
  metrics.failures = 0;
  for (const key of Object.keys(metrics.totals) as DiscrepancyKey[]) metrics.totals[key] = 0;
  metrics.lastRunAt = null;
  metrics.lastReport = null;
}

// ── Reconciler ─────────────────────────────────────────────────────────────

export class SqliteDigestReconciler implements DigestReconciler {
  /** Unresolved events per address, so recordFlush keeps them in the next window. */
  private readonly retryFrom = new Map<string, number>();

  recordRegistration(config: DigestUserConfig, nowMs: number): void {
    getDb()
      .prepare(
        `INSERT INTO digest_state (stellar_address, config, registered_at, last_flushed_at)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(stellar_address) DO UPDATE SET config = excluded.config`
      )
      .run(config.stellarAddress, JSON.stringify(config), nowMs);
  }

  recordBuffered(stellarAddress: string, item: DigestItem, nowMs: number): void {
    if (!item.eventId) return;
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO digest_pending (stellar_address, event_id, item, buffered_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(stellarAddress, item.eventId, JSON.stringify(item), nowMs);
  }

  loadRegistrations(): Array<{
    config: DigestUserConfig;
    lastFlushedAt: number;
    items: DigestItem[];
  }> {
    const rows = getDb()
      .prepare('SELECT * FROM digest_state ORDER BY stellar_address ASC')
      .all() as StateRow[];

    return rows.map((row) => ({
      config: JSON.parse(row.config) as DigestUserConfig,
      lastFlushedAt: row.last_flushed_at ?? 0,
      items: this.pendingItems(row.stellar_address),
    }));
  }

  reconcile(stellarAddress: string, items: DigestItem[], nowMs: number): DigestItem[] {
    metrics.runs += 1;
    metrics.lastRunAt = nowMs;
    try {
      const { items: reconciled, report } = this.reconcileWithReport(stellarAddress, items, nowMs);
      for (const key of Object.keys(metrics.totals) as DiscrepancyKey[]) {
        metrics.totals[key] += report[key];
      }
      metrics.lastReport = report;
      console.info(`[digest-reconcile] ${JSON.stringify(report)}`);
      return reconciled;
    } catch (err) {
      metrics.failures += 1;
      console.error(
        `[digest-reconcile] ${JSON.stringify({ stellarAddress, status: 'failed' })}`,
        err
      );
      throw err;
    }
  }

  reconcileWithReport(
    stellarAddress: string,
    items: DigestItem[],
    nowMs: number
  ): { items: DigestItem[]; report: DigestReconciliationReport } {
    const db = getDb();
    const windowStart = this.windowStart(stellarAddress, nowMs);
    const report: DigestReconciliationReport = {
      stellarAddress,
      windowStart,
      windowEnd: nowMs,
      kept: 0,
      backfilled: 0,
      duplicates: 0,
      alreadyDelivered: 0,
      orphaned: 0,
      mismatched: 0,
      unresolved: 0,
    };

    const delivered = new Set(
      (
        db
          .prepare('SELECT event_id FROM digest_deliveries WHERE stellar_address = ?')
          .all(stellarAddress) as Array<{ event_id: string }>
      ).map((row) => row.event_id)
    );
    const eventById = db.prepare('SELECT * FROM events WHERE event_id = ?');
    const invoiceById = db.prepare('SELECT * FROM invoices WHERE id = ?');

    const kept: DigestItem[] = [];
    const seen = new Set<string>();
    const candidates = [...items, ...this.pendingItems(stellarAddress)];

    for (const item of candidates) {
      if (item.eventId) {
        if (seen.has(item.eventId)) {
          // The persisted copy of an item still in memory is not a duplicate
          // the user would have seen, so only count true repeats in `items`.
          if (items.includes(item)) report.duplicates += 1;
          continue;
        }
        seen.add(item.eventId);

        if (delivered.has(item.eventId)) {
          report.alreadyDelivered += 1;
          continue;
        }
      }

      if (CHAIN_EVENT_TYPES.has(item.eventType)) {
        const event = item.eventId
          ? (eventById.get(item.eventId) as EventRow | undefined)
          : undefined;
        if (!event) {
          report.orphaned += 1;
          continue;
        }
        const invoice = invoiceById.get(event.invoice_id) as Invoice | undefined;
        if (
          event.invoice_id !== item.invoiceId ||
          event.event_type !== item.eventType ||
          (invoice && !this.isRecipient(stellarAddress, event.event_type, invoice))
        ) {
          report.mismatched += 1;
          continue;
        }
      }

      kept.push(item);
    }

    const windowEvents = db
      .prepare(
        `SELECT * FROM events
         WHERE created_at > ? AND created_at <= ?
         ORDER BY created_at ASC, event_id ASC`
      )
      .all(windowStart, nowMs) as EventRow[];

    let earliestUnresolved: number | null = null;
    for (const event of windowEvents) {
      if (seen.has(event.event_id) || delivered.has(event.event_id)) continue;
      if (!EVENT_TO_TRIGGER[event.event_type]) continue;

      const invoice = invoiceById.get(event.invoice_id) as Invoice | undefined;
      if (!invoice) {
        report.unresolved += 1;
        earliestUnresolved ??= event.created_at;
        continue;
      }
      if (!this.isRecipient(stellarAddress, event.event_type, invoice)) continue;

      seen.add(event.event_id);
      kept.push({
        eventId: event.event_id,
        invoiceId: invoice.id,
        eventType: event.event_type,
        amount: invoice.amount,
        freelancer: invoice.freelancer,
        payer: invoice.payer,
        dueDate: invoice.due_date,
        occurredAt: event.created_at,
      });
      report.backfilled += 1;
    }

    if (earliestUnresolved !== null) {
      this.retryFrom.set(stellarAddress, earliestUnresolved - 1);
    } else {
      this.retryFrom.delete(stellarAddress);
    }

    report.kept = kept.length;
    return { items: kept, report };
  }

  recordFlush(stellarAddress: string, items: DigestItem[], nowMs: number): void {
    const db = getDb();
    const watermark = this.retryFrom.get(stellarAddress) ?? nowMs;
    const insertDelivery = db.prepare(
      `INSERT OR IGNORE INTO digest_deliveries
         (stellar_address, event_id, invoice_id, event_type, delivered_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    db.exec('BEGIN');
    try {
      for (const item of items) {
        if (!item.eventId) continue;
        insertDelivery.run(stellarAddress, item.eventId, item.invoiceId, item.eventType, nowMs);
      }
      db.prepare('DELETE FROM digest_pending WHERE stellar_address = ?').run(stellarAddress);
      db.prepare('UPDATE digest_state SET last_flushed_at = ? WHERE stellar_address = ?').run(
        watermark,
        stellarAddress
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  private windowStart(stellarAddress: string, nowMs: number): number {
    const row = getDb()
      .prepare('SELECT registered_at, last_flushed_at FROM digest_state WHERE stellar_address = ?')
      .get(stellarAddress) as Pick<StateRow, 'registered_at' | 'last_flushed_at'> | undefined;
    if (!row) return nowMs;
    return row.last_flushed_at ?? row.registered_at;
  }

  private pendingItems(stellarAddress: string): DigestItem[] {
    return (
      getDb()
        .prepare(
          'SELECT item FROM digest_pending WHERE stellar_address = ? ORDER BY buffered_at ASC'
        )
        .all(stellarAddress) as Array<{ item: string }>
    ).map((row) => JSON.parse(row.item) as DigestItem);
  }

  private isRecipient(stellarAddress: string, eventType: ILNEventType, invoice: Invoice): boolean {
    const trigger = EVENT_TO_TRIGGER[eventType];
    if (!trigger) return false;
    return getNotificationTargets(trigger, invoice).some(
      (target) => target.recipient === stellarAddress
    );
  }
}

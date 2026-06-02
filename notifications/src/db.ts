import Database from 'better-sqlite3';
import { CONFIG } from './config';
import type {
  ILNEventType,
  Invoice,
  NotificationTrigger,
  Subscription,
  SubscriptionChannel,
} from './types';

type SQLiteDatabase = InstanceType<typeof Database>;

let _db: SQLiteDatabase | null = null;

export function getDb(): SQLiteDatabase {
  if (!_db) {
    _db = createDb(CONFIG.dbPath);
  }
  return _db;
}

export function createDb(path: string): SQLiteDatabase {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function setDb(db: SQLiteDatabase): void {
  _db = db;
}

function runMigrations(db: SQLiteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
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

    CREATE TABLE IF NOT EXISTS events (
      event_id         TEXT    PRIMARY KEY,
      event_type       TEXT    NOT NULL,
      invoice_id       INTEGER NOT NULL,
      ledger           INTEGER NOT NULL,
      ledger_closed_at TEXT    NOT NULL,
      created_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cursor (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      last_ledger  INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id              INTEGER PRIMARY KEY,
      stellar_address TEXT    NOT NULL,
      channel         TEXT    NOT NULL CHECK (channel IN ('email', 'webhook')),
      destination     TEXT    NOT NULL,
      triggers        TEXT    NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sent_notifications (
      id                INTEGER PRIMARY KEY,
      invoice_id        INTEGER NOT NULL,
      trigger           TEXT    NOT NULL,
      recipient_address TEXT    NOT NULL,
      channel           TEXT    NOT NULL,
      destination       TEXT    NOT NULL,
      event_id          TEXT,
      sent_at           INTEGER NOT NULL,
      UNIQUE (invoice_id, trigger, recipient_address, channel, destination)
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_status     ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_freelancer ON invoices(freelancer);
    CREATE INDEX IF NOT EXISTS idx_invoices_payer      ON invoices(payer);
    CREATE INDEX IF NOT EXISTS idx_invoices_funder     ON invoices(funder);
    CREATE INDEX IF NOT EXISTS idx_events_invoice_id   ON events(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_address ON subscriptions(stellar_address);
    CREATE INDEX IF NOT EXISTS idx_sent_notifications_invoice ON sent_notifications(invoice_id);
  `);
}

export function upsertInvoice(invoice: Omit<Invoice, 'created_at' | 'updated_at'>): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO invoices
         (id, freelancer, payer, amount, due_date, discount_rate,
          status, funder, funded_at, created_at, updated_at)
       VALUES
         (@id, @freelancer, @payer, @amount, @due_date, @discount_rate,
          @status, @funder, @funded_at, @created_at, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         status    = excluded.status,
         funder    = excluded.funder,
         funded_at = excluded.funded_at,
         updated_at = excluded.updated_at`
    )
    .run({
      ...invoice,
      funder: invoice.funder ?? null,
      funded_at: invoice.funded_at ?? null,
      created_at: now,
      updated_at: now,
    });
}

export function getInvoiceById(id: number): Invoice | undefined {
  return getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Invoice | undefined;
}

export function queryInvoicesByStatus(status: string): Invoice[] {
  return getDb()
    .prepare('SELECT * FROM invoices WHERE status = ? ORDER BY id ASC')
    .all(status) as Invoice[];
}

export function hasEvent(eventId: string): boolean {
  return getDb().prepare('SELECT 1 FROM events WHERE event_id = ?').get(eventId) !== undefined;
}

export function insertEvent(event: {
  event_id: string;
  event_type: ILNEventType;
  invoice_id: number;
  ledger: number;
  ledger_closed_at: string;
  created_at: number;
}): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO events
         (event_id, event_type, invoice_id, ledger, ledger_closed_at, created_at)
       VALUES
         (@event_id, @event_type, @invoice_id, @ledger, @ledger_closed_at, @created_at)`
    )
    .run(event);
}

export function getCursorLedger(): number {
  const row = getDb().prepare('SELECT last_ledger FROM cursor WHERE id = 1').get() as
    | { last_ledger: number }
    | undefined;
  return row?.last_ledger ?? 0;
}

export function setCursorLedger(ledger: number): void {
  getDb()
    .prepare(
      `INSERT INTO cursor (id, last_ledger, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_ledger = excluded.last_ledger,
         updated_at  = excluded.updated_at`
    )
    .run(ledger, Date.now());
}

export function createSubscription(
  subscription: Omit<Subscription, 'id' | 'created_at'>
): Subscription {
  const now = Date.now();
  const result = getDb()
    .prepare(
      `INSERT INTO subscriptions
         (stellar_address, channel, destination, triggers, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      subscription.stellar_address,
      subscription.channel,
      subscription.destination,
      JSON.stringify(subscription.triggers),
      now
    );

  return {
    id: Number(result.lastInsertRowid),
    ...subscription,
    created_at: now,
  };
}

export function getSubscriptionsByAddress(address: string): Subscription[] {
  return getDb()
    .prepare('SELECT * FROM subscriptions WHERE stellar_address = ? ORDER BY id ASC')
    .all(address)
    .map((row: any) => ({
      id: row.id,
      stellar_address: row.stellar_address,
      channel: row.channel,
      destination: row.destination,
      triggers: JSON.parse(row.triggers),
      created_at: row.created_at,
    })) as Subscription[];
}

export function getSubscriptionById(id: number): Subscription | undefined {
  const row = getDb().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as any;

  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    stellar_address: row.stellar_address,
    channel: row.channel,
    destination: row.destination,
    triggers: JSON.parse(row.triggers),
    created_at: row.created_at,
  } as Subscription;
}

export function deleteSubscriptionById(id: number): boolean {
  const result = getDb().prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteSubscriptionByAddressAndDestination(
  address: string,
  destination: string
): boolean {
  const result = getDb()
    .prepare('DELETE FROM subscriptions WHERE stellar_address = ? AND destination = ?')
    .run(address, destination);
  return result.changes > 0;
}

export function hasSentNotification(
  invoiceId: number,
  trigger: NotificationTrigger,
  recipientAddress: string,
  channel: SubscriptionChannel,
  destination: string
): boolean {
  return (
    getDb()
      .prepare(
        `SELECT 1 FROM sent_notifications
         WHERE invoice_id = ?
           AND trigger = ?
           AND recipient_address = ?
           AND channel = ?
           AND destination = ?`
      )
      .get(invoiceId, trigger, recipientAddress, channel, destination) !== undefined
  );
}

export function logSentNotification(
  invoiceId: number,
  trigger: NotificationTrigger,
  recipientAddress: string,
  channel: SubscriptionChannel,
  destination: string,
  eventId?: string
): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO sent_notifications
         (invoice_id, trigger, recipient_address, channel, destination, event_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(invoiceId, trigger, recipientAddress, channel, destination, eventId ?? null, Date.now());
}

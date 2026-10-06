import { getDb } from './db';
import { eventsDeadLetteredTotal } from './metrics';

/**
 * Dead-letter path for events the indexer cannot process. Rows are appended,
 * never mutated by the processor; replay tooling marks `replayed_at`.
 */
export interface DeadLetterRecord {
  id: number;
  event_id: string | null;
  reason: string;
  detail: string | null;
  payload: string;
  ledger: number | null;
  created_at: number;
  replayed_at: number | null;
}

export const MAX_DEAD_LETTER_PAYLOAD_BYTES = 64 * 1024;

/**
 * JSON-serialises an arbitrary event payload without ever throwing: XDR
 * values become `{ "$xdr": base64 }`, bigints `{ "$bigint": "..." }`,
 * `undefined` is kept explicit, cycles are cut, and the result is capped.
 */
export function serializeEventPayload(raw: unknown): string {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') return { $bigint: value.toString() };
    if (typeof value === 'undefined') return { $undefined: true };
    if (typeof value === 'function' || typeof value === 'symbol')
      return { $unserializable: typeof value };
    if (typeof value === 'object' && value !== null) {
      const candidate = value as { toXDR?: (format: string) => string; switch?: unknown };
      if (typeof candidate.toXDR === 'function' && typeof candidate.switch === 'function') {
        try {
          return { $xdr: candidate.toXDR('base64') };
        } catch {
          return { $xdr_error: true };
        }
      }
      if (seen.has(value)) return { $cycle: true };
      seen.add(value);
    }
    return value;
  };
  let json: string;
  try {
    json = JSON.stringify(raw === undefined ? { $undefined: true } : raw, replacer) ?? 'null';
  } catch (err) {
    json = JSON.stringify({ $unserializable: err instanceof Error ? err.message : String(err) });
  }
  if (json.length > MAX_DEAD_LETTER_PAYLOAD_BYTES) {
    json = JSON.stringify({ $truncated: true, head: json.slice(0, MAX_DEAD_LETTER_PAYLOAD_BYTES) });
  }
  return json;
}

function safeEventId(raw: unknown): string | null {
  const id = (raw as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id.slice(0, 128) : null;
}

function safeLedger(raw: unknown): number | null {
  const ledger = (raw as { ledger?: unknown } | null)?.ledger;
  return typeof ledger === 'number' && Number.isSafeInteger(ledger) ? ledger : null;
}

/** Records an unprocessable event and returns the dead-letter row id. */
export function deadLetterEvent(raw: unknown, reason: string, detail?: string): number {
  const result = getDb()
    .prepare(
      `INSERT INTO dead_letter_events (event_id, reason, detail, payload, ledger, created_at)
       VALUES (@event_id, @reason, @detail, @payload, @ledger, @created_at)`
    )
    .run({
      event_id: safeEventId(raw),
      reason,
      detail: detail === undefined ? null : detail.slice(0, 512),
      payload: serializeEventPayload(raw),
      ledger: safeLedger(raw),
      created_at: Date.now(),
    });
  try {
    eventsDeadLetteredTotal.inc({ reason });
  } catch {
    /* metrics failure is non-fatal */
  }
  console.warn(`[processor] dead-lettered event ${safeEventId(raw) ?? '<no id>'}: ${reason}`);
  return Number(result.lastInsertRowid);
}

export function listDeadLetters(limit = 100, offset = 0): DeadLetterRecord[] {
  return getDb()
    .prepare('SELECT * FROM dead_letter_events ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as DeadLetterRecord[];
}

export function countDeadLetters(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM dead_letter_events').get() as {
    count: number;
  };
  return row.count;
}

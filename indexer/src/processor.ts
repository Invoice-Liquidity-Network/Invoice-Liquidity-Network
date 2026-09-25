import type { rpc } from '@stellar/stellar-sdk';
import { getDb, hasEvent, insertEvent, upsertInvoice } from './db';
import { deadLetterEvent } from './deadLetter';
import { decodeEvent, isValidInvoiceState } from './decode';
import { eventsProcessedTotal, invoicesUpsertedTotal } from './metrics';
import { invalidateInvoiceCache } from './cache';
import { fetchInvoice } from './rpc';
import type { ILNEvent } from './types';
import {
  pubsub,
  INVOICE_UPDATED,
  EVENT_STREAM,
  LEGACY_INVOICE_CREATED,
  LEGACY_INVOICE_UPDATED,
} from './graphql/pubsub';

/**
 * Process a single Soroban contract event:
 * 1. Decode and validate the raw payload (see decode.ts). Malformed events go
 *    to the dead-letter table; unknown topics are ignored.
 * 2. Deduplicate by event_id.
 * 3. Fetch the latest invoice state from the RPC.
 * 4. Persist the event record and the invoice state in one transaction, so a
 *    replay can never find an event marked as processed without its state.
 *
 * Fetching via RPC (rather than parsing all fields from events) ensures we
 * always have accurate state even if events are processed out-of-order or after
 * a re-org. A null state (invoice not found, RPC unavailable) still records the
 * event, as before; a malformed state is dead-lettered and the event is left
 * unprocessed so a later poll can retry it.
 *
 * Invariants (enforced by tests/processor.fuzz.test.ts): never throws for any
 * event shape while the database is healthy; idempotent for valid events; a
 * row in `events` always carries the decoded invoice id; malformed input
 * produces exactly one dead-letter row and nothing else.
 */
export async function processEvent(event: rpc.Api.EventResponse): Promise<void> {
  const decoded = decodeEvent(event);
  if (decoded.kind === 'malformed') {
    deadLetterEvent(event, decoded.reason, decoded.detail);
    return;
  }
  if (decoded.kind === 'ignored') {
    return;
  }
  const ilnEvent: ILNEvent = decoded.event;

  // ── Deduplication ─────────────────────────────────────────────────────────
  if (hasEvent(ilnEvent.event_id)) {
    return;
  }

  // ── Fetch latest invoice state ────────────────────────────────────────────
  // We always fetch the current state from the RPC regardless of event type.
  // This handles:
  //   • `submitted`  → inserts the full invoice with status=Pending
  //   • `funded`     → updates status=Funded + funder + funded_at
  //   • `paid`       → updates status=Paid
  //   • `defaulted`  → updates status=Defaulted
  const invoice = await fetchInvoice(ilnEvent.invoice_id);
  if (invoice !== null && invoice !== undefined && !isValidInvoiceState(invoice)) {
    deadLetterEvent(event, 'invalid_invoice_state');
    return;
  }

  // ── Persist event + state atomically ─────────────────────────────────────
  getDb().transaction(() => {
    insertEvent(ilnEvent);
    if (invoice) {
      upsertInvoice(invoice);
    }
  })();

  try {
    eventsProcessedTotal.inc();
  } catch {
    /* metrics failure is non-fatal */
  }

  if (invoice) {
    await invalidateInvoiceCache(ilnEvent.invoice_id);
    try {
      invoicesUpsertedTotal.inc();
    } catch {
      /* metrics failure is non-fatal */
    }
    // Publish to the single shared pubsub. The modular WebSocket schema
    // receives structured payloads, while the legacy Yoga schema receives
    // the raw invoice on its own namespaced channels (see ./graphql/pubsub).
    pubsub.publish(INVOICE_UPDATED, { invoiceUpdated: invoice, triggeringEvent: ilnEvent });
    pubsub.publish(EVENT_STREAM, { eventStream: ilnEvent });
    if (ilnEvent.event_type === 'submitted') {
      pubsub.publish(LEGACY_INVOICE_CREATED, invoice);
    } else {
      pubsub.publish(LEGACY_INVOICE_UPDATED, invoice);
    }
  }
}

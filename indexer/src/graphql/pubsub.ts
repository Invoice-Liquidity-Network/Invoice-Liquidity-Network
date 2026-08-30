import { PubSub } from 'graphql-subscriptions';
import type { Invoice, ILNEvent } from '../types';

/**
 * Single canonical pub-sub instance for the entire indexer.
 *
 * History: two separate pubsub files used to exist — `src/pubsub.ts` (driven
 * by graphql-yoga's `createPubSub`) and `src/graphql/pubsub.ts` (driven by
 * `graphql-subscriptions`' `PubSub`). `processor.ts` published to *both* on
 * every event, which duplicated work and made the two GraphQL transports
 * drift apart. That duplicate was consolidated here: this module is now the
 * one and only event bus and is shared by every publisher and subscriber.
 *
 * Channel payloads are deliberately namespaced so the two schema variants
 * served today (the current modular WebSocket schema and the legacy
 * monolithic Yoga schema) never read each other's payload shapes:
 *   • `INVOICE_UPDATED` / `EVENT_STREAM`   → modular WebSocket resolvers
 *   • `LEGACY_INVOICE_CREATED` / `LEGACY_INVOICE_UPDATED` → legacy Yoga schema
 */

/** Modular WebSocket schema: invoice-changed payload. */
export const INVOICE_UPDATED = 'INVOICE_UPDATED';
/** Modular WebSocket schema: raw event-stream payload. */
export const EVENT_STREAM = 'EVENT_STREAM';

/** Legacy Yoga schema: created-invoice payload (raw Invoice). */
export const LEGACY_INVOICE_CREATED = 'LEGACY_INVOICE_CREATED';
/** Legacy Yoga schema: updated-invoice payload (raw Invoice). */
export const LEGACY_INVOICE_UPDATED = 'LEGACY_INVOICE_UPDATED';

export interface InvoiceUpdatedPayload {
  invoiceUpdated: Invoice;
  triggeringEvent: ILNEvent;
}

export interface EventStreamPayload {
  eventStream: ILNEvent;
}

export const pubsub = new PubSub();

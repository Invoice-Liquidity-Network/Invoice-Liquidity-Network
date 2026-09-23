import { PubSub } from 'graphql-subscriptions';
import type { Invoice, ILNEvent } from '../types';

export const INVOICE_UPDATED = 'INVOICE_UPDATED';
export const EVENT_STREAM = 'EVENT_STREAM';

export interface InvoiceUpdatedPayload {
  invoiceUpdated: Invoice;
  triggeringEvent: ILNEvent;
}

export interface EventStreamPayload {
  eventStream: ILNEvent;
}

export const pubsub = new PubSub();

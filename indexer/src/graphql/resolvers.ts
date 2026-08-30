import { withFilter } from 'graphql-subscriptions';
import { getInvoiceById, getProtocolStats, queryInvoicesPaginated } from '../db';
import type { Invoice, ILNEvent } from '../types';
import {
  pubsub,
  INVOICE_UPDATED,
  EVENT_STREAM,
  type InvoiceUpdatedPayload,
  type EventStreamPayload,
} from './pubsub';

interface InvoicesArgs {
  status?: string;
  freelancer?: string;
  payer?: string;
  funder?: string;
  limit?: number;
  cursor?: string;
}

export interface InvoiceUpdatedArgs {
  id?: number;
  status?: string;
  freelancer?: string;
  payer?: string;
  funder?: string;
}

export interface EventStreamArgs {
  invoiceId?: number;
  eventType?: string;
}

// Snake_case Invoice fields → camelCase GraphQL fields
const invoiceFieldResolvers = {
  dueDate: (inv: Invoice) => inv.due_date,
  discountRate: (inv: Invoice) => inv.discount_rate,
  fundedAt: (inv: Invoice) => inv.funded_at,
  createdAt: (inv: Invoice) => inv.created_at,
  updatedAt: (inv: Invoice) => inv.updated_at,
};

const ilnEventFieldResolvers = {
  eventId: (e: ILNEvent) => e.event_id,
  eventType: (e: ILNEvent) => e.event_type,
  invoiceId: (e: ILNEvent) => e.invoice_id,
  ledgerClosedAt: (e: ILNEvent) => e.ledger_closed_at,
  createdAt: (e: ILNEvent) => e.created_at,
};

export function filterInvoiceUpdated(
  payload: InvoiceUpdatedPayload,
  variables: InvoiceUpdatedArgs
): boolean {
  const inv = payload.invoiceUpdated;
  if (variables.id !== undefined && inv.id !== variables.id) return false;
  if (variables.status && inv.status !== variables.status) return false;
  if (variables.freelancer && inv.freelancer !== variables.freelancer) return false;
  if (variables.payer && inv.payer !== variables.payer) return false;
  if (variables.funder && inv.funder !== variables.funder) return false;
  return true;
}

export function filterEventStream(
  payload: EventStreamPayload,
  variables: EventStreamArgs
): boolean {
  const ev = payload.eventStream;
  if (variables.invoiceId !== undefined && ev.invoice_id !== variables.invoiceId) return false;
  if (variables.eventType && ev.event_type !== variables.eventType) return false;
  return true;
}

export const resolvers = {
  Invoice: invoiceFieldResolvers,

  ILNEvent: ilnEventFieldResolvers,

  Query: {
    invoice(_: unknown, { id }: { id: number }) {
      return getInvoiceById(id) ?? null;
    },

    invoices(_: unknown, args: InvoicesArgs) {
      const limit = Math.min(args.limit ?? 100, 100);
      return queryInvoicesPaginated(
        {
          status: args.status || undefined,
          freelancer: args.freelancer || undefined,
          payer: args.payer || undefined,
          funder: args.funder || undefined,
        },
        limit,
        args.cursor
      );
    },

    stats() {
      return getProtocolStats();
    },
  },

  Subscription: {
    invoiceUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator<InvoiceUpdatedPayload>(INVOICE_UPDATED),
        filterInvoiceUpdated
      ),
      resolve: (payload: InvoiceUpdatedPayload) => payload.invoiceUpdated,
    },

    eventStream: {
      subscribe: withFilter(
        () => pubsub.asyncIterator<EventStreamPayload>(EVENT_STREAM),
        filterEventStream
      ),
      resolve: (payload: EventStreamPayload) => payload.eventStream,
    },
  },
};

import { createYoga, createSchema } from 'graphql-yoga';

import { GraphQLError, parse } from 'graphql';
import type { DocumentNode, ValidationContext, ASTNode, ASTVisitor } from 'graphql';
import {
  getDb,
  getInvoiceById,
  queryInvoicesPaginated,
  getProtocolStats,
  getLPStats,
  getFreelancerStats,
  getInvoiceHistory,
  getTopLPs,
  getEvents,
  getCursorUpdatedAt,
} from './db';
import { pubsub, LEGACY_INVOICE_CREATED, LEGACY_INVOICE_UPDATED } from './graphql/pubsub';
import type { Invoice, ILNEvent } from './types';

// ─── GraphQL schema ───────────────────────────────────────────────────────────

export const typeDefs = /* GraphQL */ `
  enum InvoiceStatus {
    Pending
    Funded
    Paid
    Defaulted
  }

  type Invoice {
    id: Int!
    freelancer: String!
    payer: String!
    amount: String!
    dueDate: Int!
    discountRate: Int!
    status: InvoiceStatus!
    funder: String
    fundedAt: Int
    createdAt: Int!
    updatedAt: Int!
  }

  type InvoiceEdge {
    node: Invoice!
    cursor: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type InvoiceConnection {
    edges: [InvoiceEdge!]!
    pageInfo: PageInfo!
  }

  type Event {
    eventId: String!
    eventType: String!
    invoiceId: Int!
    ledger: Int!
    ledgerClosedAt: String!
    createdAt: Int!
  }

  type ProtocolStats {
    totalInvoices: Int!
    totalVolume: String!
    totalYield: String!
    defaultRate: Float!
  }

  type LPStats {
    deployed: String!
    yield: String!
    invoiceCount: Int!
    defaultRate: Float!
  }

  type FreelancerStats {
    submitted: Int!
    funded: Int!
    totalReceived: String!
    avgDiscount: Float!
  }

  type LPStat {
    address: String!
    yield: String!
    invoiceCount: Int!
  }

  type HealthStatus {
    status: String!
    db: String!
    lastSync: String
    uptime: Int!
  }

  type Query {
    health: HealthStatus!
    invoice(id: Int!): Invoice
    invoices(
      status: InvoiceStatus
      freelancer: String
      payer: String
      funder: String
      first: Int
      after: String
    ): InvoiceConnection!
    events(invoiceId: Int): [Event!]!
    protocolStats: ProtocolStats!
    lpStats(address: String!): LPStats!
    freelancerStats(address: String!): FreelancerStats!
    topLPs(limit: Int, period: String): [LPStat!]!
    history(address: String!, role: String): [Invoice!]!
  }

  type Subscription {
    invoiceCreated: Invoice!
    invoiceUpdated: Invoice!
  }
`;

// ─── Resolvers ────────────────────────────────────────────────────────────────

const startTime = Date.now();

const resolvers = {
  // Map snake_case DB fields to camelCase GraphQL fields
  Invoice: {
    dueDate: (i: Invoice) => i.due_date,
    discountRate: (i: Invoice) => i.discount_rate,
    fundedAt: (i: Invoice) => i.funded_at ?? null,
    createdAt: (i: Invoice) => i.created_at,
    updatedAt: (i: Invoice) => i.updated_at,
  },

  Event: {
    eventId: (e: ILNEvent) => e.event_id,
    eventType: (e: ILNEvent) => e.event_type,
    invoiceId: (e: ILNEvent) => e.invoice_id,
    ledgerClosedAt: (e: ILNEvent) => e.ledger_closed_at,
    createdAt: (e: ILNEvent) => e.created_at,
  },

  Query: {
    health: () => {
      let dbStatus: 'ok' | 'error' = 'ok';
      try {
        getDb().prepare('SELECT 1').get();
      } catch {
        dbStatus = 'error';
      }
      const lastSyncMs = getCursorUpdatedAt();
      return {
        status: dbStatus === 'ok' ? 'ok' : 'degraded',
        db: dbStatus,
        lastSync: lastSyncMs !== null ? new Date(lastSyncMs).toISOString() : null,
        uptime: Date.now() - startTime,
      };
    },

    invoice: (_: unknown, { id }: { id: number }) => {
      return getInvoiceById(id) ?? null;
    },

    invoices: (
      _: unknown,
      args: {
        status?: string;
        freelancer?: string;
        payer?: string;
        funder?: string;
        first?: number;
        after?: string;
      }
    ) => {
      const limit = Math.min(args.first ?? 100, 100);
      const { invoices, hasMore, nextCursor } = queryInvoicesPaginated(
        {
          status: args.status,
          freelancer: args.freelancer,
          payer: args.payer,
          funder: args.funder,
        },
        limit,
        args.after
      );

      return {
        edges: invoices.map((invoice) => ({
          node: invoice,
          cursor: Buffer.from(String(invoice.id)).toString('base64'),
        })),
        pageInfo: {
          hasNextPage: hasMore,
          endCursor: nextCursor ?? null,
        },
      };
    },

    events: (_: unknown, { invoiceId }: { invoiceId?: number }) => {
      return getEvents(invoiceId);
    },

    protocolStats: () => getProtocolStats(),

    lpStats: (_: unknown, { address }: { address: string }) => getLPStats(address),

    freelancerStats: (_: unknown, { address }: { address: string }) => getFreelancerStats(address),

    topLPs: (_: unknown, { limit = 10, period = 'all' }: { limit?: number; period?: string }) => {
      if (!['all', 'week', 'month'].includes(period)) {
        throw new Error('period must be all, week, or month');
      }
      return getTopLPs(Math.min(limit, 100), period);
    },

    history: (_: unknown, { address, role = 'freelancer' }: { address: string; role?: string }) => {
      if (role !== 'freelancer' && role !== 'payer' && role !== 'funder') {
        throw new Error('role must be freelancer, payer, or funder');
      }
      return getInvoiceHistory(address, role);
    },
  },

  Subscription: {
    invoiceCreated: {
      subscribe: () => pubsub.asyncIterator<Invoice>(LEGACY_INVOICE_CREATED),
      resolve: (invoice: Invoice) => invoice,
    },
    invoiceUpdated: {
      subscribe: () => pubsub.asyncIterator<Invoice>(LEGACY_INVOICE_UPDATED),
      resolve: (invoice: Invoice) => invoice,
    },
  },
};

// ─── Yoga handler factory ─────────────────────────────────────────────────────

const MAX_GRAPHQL_COMPLEXITY = 50;
const MAX_GRAPHQL_DEPTH = 1;

function getDepth(node: ASTNode, current = 0): number {
  if (!('selectionSet' in node) || !node.selectionSet) return current;
  return Math.max(
    current + 1,
    ...node.selectionSet.selections.map((selection) => getDepth(selection, current + 1))
  );
}

export function validateGraphQLDocument(
  schema: ReturnType<typeof createSchema>,
  document: DocumentNode
): GraphQLError[] {
  const complexity = document.definitions.reduce((total, definition) => {
    if (definition.kind === 'OperationDefinition' && getDepth(definition) > MAX_GRAPHQL_DEPTH) {
      return total + MAX_GRAPHQL_COMPLEXITY + 1;
    }
    if (definition.kind !== 'OperationDefinition') return total;
    return total + definition.selectionSet.selections.length;
  }, 0);
  const errors: GraphQLError[] = [];
  if (complexity > MAX_GRAPHQL_COMPLEXITY) {
    errors.push(new GraphQLError(`GraphQL query is too complex (maximum complexity is ${MAX_GRAPHQL_COMPLEXITY}).`));
  }
  if (getDepth(document) > MAX_GRAPHQL_DEPTH) {
    errors.push(new GraphQLError(`GraphQL query is too deep (maximum depth is ${MAX_GRAPHQL_DEPTH}).`));
  }
  return errors;
}

const complexityRule = (context: ValidationContext): ASTVisitor => {
  const document = context.getDocument();
  for (const error of validateGraphQLDocument(createSchema({ typeDefs, resolvers }), document)) {
    context.reportError(error);
  }
  return {};
};

export function createGraphQLHandler(): any {
  const schema = createSchema({ typeDefs, resolvers });
  const originalFetch = createYoga({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: process.env.NODE_ENV !== 'production',
    logging: false,
  });
  const handler = async (request: Request): Promise<Response> => {
      if (request.method === 'POST' && request.headers?.get?.('content-type')?.includes('application/json')) {
        const body = (await request.clone().json()) as { query?: string };
        if (typeof body.query === 'string') {
          const errors = validateGraphQLDocument(schema, parse(body.query));
          if (errors.length > 0) {
            return Response.json({ errors }, { status: 400 });
          }
        }
      }
      return originalFetch.fetch(request);
  };
  return Object.assign(handler, originalFetch, { fetch: handler });
}

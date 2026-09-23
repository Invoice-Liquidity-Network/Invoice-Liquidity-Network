export const typeDefs = `#graphql
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
    """
    True when this invoice is referenced by an event still inside the
    confirmation window - its state may yet change due to a ledger reorg.
    Invoices are only surfaced once confirmed, so this is normally false.
    """
    provisional: Boolean!
  }

  enum InvoiceStatus {
    Pending
    Funded
    Paid
    Defaulted
  }

  enum ILNEventType {
    submitted
    funded
    paid
    defaulted
  }

  type ILNEvent {
    eventId: String!
    eventType: ILNEventType!
    invoiceId: Int!
    ledger: Int!
    ledgerClosedAt: String!
    createdAt: Int!
    """
    True once this event's ledger is confirmation-depth behind the chain tip.
    The indexer only persists confirmed events, so this is always true for
    surfaced events - it exists so consumers can enforce the same policy.
    """
    confirmed: Boolean!
  }

  type InvoicePage {
    invoices: [Invoice!]!
    hasMore: Boolean!
    nextCursor: String
  }

  type ProtocolStats {
    totalInvoices: Int!
    totalVolume: String!
    totalYield: String!
    defaultRate: Float!
  }

  """
  Reorg/confirmation status of the indexer's chain view.
  """
  type IndexerStatus {
    """
    Highest ledger the indexer has observed (events + cursor + recorded hashes).
    """
    latestLedger: Int!
    """
    Ledger boundary below which state is final: latestLedger - confirmationDepth.
    """
    latestConfirmedLedger: Int!
    """
    Number of ledgers a block must be behind the tip before state is final.
    """
    confirmationDepth: Int!
  }

  type Query {
    invoice(id: Int!): Invoice
    invoices(
      status: InvoiceStatus
      freelancer: String
      payer: String
      funder: String
      limit: Int
      cursor: String
    ): InvoicePage!
    stats: ProtocolStats!
    indexerStatus: IndexerStatus!
  }

  type Subscription {
    invoiceUpdated(
      id: Int
      status: InvoiceStatus
      freelancer: String
      payer: String
      funder: String
    ): Invoice!

    eventStream(
      invoiceId: Int
      eventType: ILNEventType
    ): ILNEvent!
  }
`;

/**
 * Type-level tests for the contract event types and the `ContractEvent` union.
 *
 * Consumers switch on `event.type` and then read variant-specific fields, so the
 * value of this union is entirely in how it narrows. Each variant is therefore
 * constructed once and then narrowed out of the union, which catches both a
 * missing member and a payload whose field types drifted.
 */
import { expectAssignable, expectError, expectType } from 'tsd';
import type {
  ContractEvent,
  ContractStats,
  ContractStatsUpdatedEvent,
  GovernanceProposal,
  GovernanceProposalCreatedEvent,
  GovernanceProposalExecutedEvent,
  Invoice,
  InvoiceDefaultedEvent,
  InvoiceFundedEvent,
  InvoicePaidEvent,
  InvoiceStatus,
  InvoiceSubmittedEvent,
  LPStats,
  LPStatsUpdatedEvent,
  ReputationScore,
  ReputationUpdatedEvent,
  Token,
  TokenAddedEvent,
  TokenRemovedEvent,
  VoteCastEvent,
} from '@iln/shared';

// ─── Payload fixtures ─────────────────────────────────────────────────────────

const invoice: Invoice = {
  id: 1n,
  freelancer: 'GFREELANCER',
  payer: 'GPAYER',
  token: 'CUSDC',
  amount: 25_000_000n,
  dueDate: 1_700_000_000,
  discountRate: 300,
  status: 'Funded',
  funder: 'GFUNDER',
  fundedAt: 1_700_000_500,
  amountFunded: 25_000_000n,
  amountPaid: 0n,
  submitterReputation: 72,
  referralCode: null,
  allowedLps: null,
  isAuction: false,
  auctionStartRate: null,
  auctionMinRate: null,
  auctionRateDecayPerHour: null,
  auctionStartedAt: null,
};

const proposal: GovernanceProposal = {
  id: 1n,
  proposer: 'GPROPOSER',
  descriptionHash: new Uint8Array(32),
  actionType: { type: 'UpdateFeeRate', value: 250 },
  proposedValue: 250n,
  status: 'Active',
  votesFor: 10_000n,
  votesAgainst: 2_000n,
  createdAt: 1_700_000_000,
  votingEndsAt: 1_700_259_200,
  etaLedger: null,
};

const token: Token = {
  contractId: 'CUSDC',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 7,
  issuer: 'GISSUER',
  listed: true,
};

const reputation: ReputationScore = {
  address: 'GADDRESS',
  score: 87,
  invoicesSubmitted: 12n,
  invoicesPaid: 11n,
  invoicesDefaulted: 1n,
  lastActivityLedger: 5_500_000n,
};

const contractStats: ContractStats = {
  totalInvoices: 3n,
  totalFunded: 2n,
  totalPaid: 1n,
  totalVolume: 75_000_000n,
};

const lpStats: LPStats = {
  totalFunded: 50_000_000n,
  totalEarned: 1_000_000n,
  activePositions: 2n,
  totalPositions: 9n,
  avgYieldBps: 275,
};

const base = {
  contractId: 'CINVOICE',
  ledger: 5_500_000,
  ledgerClosedAt: '2024-01-01T00:00:00Z',
  txHash: 'abc123',
  pagingToken: '5500000-0',
};

// ─── Every event carries the shared ledger metadata ───────────────────────────

const submitted: InvoiceSubmittedEvent = { ...base, type: 'InvoiceSubmitted', invoice };

expectType<string>(submitted.contractId);
expectType<number>(submitted.ledger);
expectType<string>(submitted.ledgerClosedAt);
expectType<string>(submitted.txHash);
expectType<string>(submitted.pagingToken);
expectType<Invoice>(submitted.invoice);

// The ledger sequence is a number; the paging token and close time are strings.
expectError<InvoiceSubmittedEvent>({ ...submitted, ledger: 5_500_000n });
expectError<InvoiceSubmittedEvent>({ ...submitted, ledgerClosedAt: 1_700_000_000 });
// Metadata is not optional — an event without provenance is not an event.
expectError<InvoiceSubmittedEvent>({ type: 'InvoiceSubmitted', invoice });

// ─── Invoice events ───────────────────────────────────────────────────────────

const funded: InvoiceFundedEvent = {
  ...base,
  type: 'InvoiceFunded',
  invoiceId: 1n,
  funder: 'GFUNDER',
  amount: 10_000_000n,
  amountFunded: 25_000_000n,
  effectiveYieldBps: 300,
  status: 'Funded',
};

expectType<bigint>(funded.invoiceId);
expectType<string>(funded.funder);
expectType<bigint>(funded.amount);
expectType<bigint>(funded.amountFunded);
expectType<number>(funded.effectiveYieldBps);
expectType<InvoiceStatus>(funded.status);

// Partial funding reports the cumulative total alongside this call's amount.
expectAssignable<InvoiceFundedEvent>({ ...funded, amount: 5_000_000n, status: 'PartiallyFunded' });

// The three fields added when the event was reconciled with the contract.
expectError<InvoiceFundedEvent>({
  ...base,
  type: 'InvoiceFunded',
  invoiceId: 1n,
  funder: 'GFUNDER',
  amount: 10_000_000n,
});
expectError<InvoiceFundedEvent>({ ...funded, effectiveYieldBps: 300n });

const paid: InvoicePaidEvent = {
  ...base,
  type: 'InvoicePaid',
  invoiceId: 1n,
  payer: 'GPAYER',
  amount: 25_000_000n,
  lpEarned: 750_000n,
  lpPayout: 25_750_000n,
};

expectType<bigint>(paid.invoiceId);
expectType<string>(paid.payer);
expectType<bigint>(paid.amount);
expectType<bigint>(paid.lpEarned);
expectType<bigint>(paid.lpPayout);

expectError<InvoicePaidEvent>({ ...paid, lpEarned: 750_000 });

const defaulted: InvoiceDefaultedEvent = {
  ...base,
  type: 'InvoiceDefaulted',
  invoiceId: 1n,
  funder: null,
  amountRecovered: 0n,
};

expectType<bigint>(defaulted.invoiceId);
// An invoice can default before any LP funded it, so the funder is nullable here
// even though InvoiceFundedEvent always has one.
expectType<string | null>(defaulted.funder);
expectType<bigint>(defaulted.amountRecovered);

expectAssignable<InvoiceDefaultedEvent>({
  ...defaulted,
  funder: 'GFUNDER',
  amountRecovered: 5_000_000n,
});
expectError<InvoiceDefaultedEvent>({ ...defaulted, funder: undefined });

// ─── Governance events ────────────────────────────────────────────────────────

const proposalCreated: GovernanceProposalCreatedEvent = {
  ...base,
  type: 'ProposalCreated',
  proposal,
};

expectType<GovernanceProposal>(proposalCreated.proposal);

const voteCast: VoteCastEvent = {
  ...base,
  type: 'VoteCast',
  proposalId: 1n,
  voter: 'GVOTER',
  support: true,
  weight: 10_000n,
};

expectType<bigint>(voteCast.proposalId);
expectType<string>(voteCast.voter);
expectType<boolean>(voteCast.support);
expectType<bigint>(voteCast.weight);

// support is a boolean flag, not a "For"/"Against" string.
expectError<VoteCastEvent>({ ...voteCast, support: 'For' });
expectError<VoteCastEvent>({ ...voteCast, weight: 10_000 });

const proposalExecuted: GovernanceProposalExecutedEvent = {
  ...base,
  type: 'ProposalExecuted',
  proposalId: 1n,
  executor: 'GEXECUTOR',
};

expectType<bigint>(proposalExecuted.proposalId);
expectType<string>(proposalExecuted.executor);

// ─── Token events ─────────────────────────────────────────────────────────────

const tokenAdded: TokenAddedEvent = { ...base, type: 'TokenAdded', token };
const tokenRemoved: TokenRemovedEvent = { ...base, type: 'TokenRemoved', token };

expectType<Token>(tokenAdded.token);
expectType<Token>(tokenRemoved.token);
expectError<TokenAddedEvent>({ ...base, type: 'TokenAdded', token: 'CUSDC' });

// ─── Reputation and derived stats events ──────────────────────────────────────

const reputationUpdated: ReputationUpdatedEvent = {
  ...base,
  type: 'ReputationUpdated',
  reputation,
};

expectType<ReputationScore>(reputationUpdated.reputation);

// Not contract-emitted: synthesised client-side, but still part of the union so
// a consumer's exhaustive switch has to handle them.
const contractStatsUpdated: ContractStatsUpdatedEvent = {
  ...base,
  type: 'ContractStatsUpdated',
  stats: contractStats,
};

const lpStatsUpdated: LPStatsUpdatedEvent = {
  ...base,
  type: 'LPStatsUpdated',
  address: 'GLP',
  stats: lpStats,
};

expectType<ContractStats>(contractStatsUpdated.stats);
expectType<string>(lpStatsUpdated.address);
expectType<LPStats>(lpStatsUpdated.stats);

// ─── The union narrows on `type` ──────────────────────────────────────────────

declare const event: ContractEvent;

switch (event.type) {
  case 'InvoiceSubmitted':
    expectType<Invoice>(event.invoice);
    break;
  case 'InvoiceFunded':
    expectType<bigint>(event.amountFunded);
    expectType<number>(event.effectiveYieldBps);
    expectType<InvoiceStatus>(event.status);
    break;
  case 'InvoicePaid':
    expectType<bigint>(event.lpPayout);
    expectType<string>(event.payer);
    break;
  case 'InvoiceDefaulted':
    expectType<string | null>(event.funder);
    expectType<bigint>(event.amountRecovered);
    break;
  case 'ProposalCreated':
    expectType<GovernanceProposal>(event.proposal);
    break;
  case 'VoteCast':
    expectType<boolean>(event.support);
    expectType<bigint>(event.weight);
    break;
  case 'ProposalExecuted':
    expectType<string>(event.executor);
    break;
  case 'TokenAdded':
  case 'TokenRemoved':
    expectType<Token>(event.token);
    break;
  case 'ReputationUpdated':
    expectType<ReputationScore>(event.reputation);
    break;
  case 'ContractStatsUpdated':
    expectType<ContractStats>(event.stats);
    break;
  case 'LPStatsUpdated':
    expectType<LPStats>(event.stats);
    expectType<string>(event.address);
    break;
  default:
    // Every member is handled above, so the union is exhausted here. A new
    // variant added to ContractEvent fails this line until it is handled.
    expectType<never>(event);
}

// Narrowing must not leak fields between variants.
if (event.type === 'InvoicePaid') {
  expectError(event.funder);
}

// A type tag the union does not contain is rejected outright.
expectError<ContractEvent>({ ...base, type: 'InvoiceCancelled', invoiceId: 1n });

expectAssignable<ContractEvent>(submitted);
expectAssignable<ContractEvent>(funded);
expectAssignable<ContractEvent>(paid);
expectAssignable<ContractEvent>(defaulted);
expectAssignable<ContractEvent>(proposalCreated);
expectAssignable<ContractEvent>(voteCast);
expectAssignable<ContractEvent>(proposalExecuted);
expectAssignable<ContractEvent>(tokenAdded);
expectAssignable<ContractEvent>(tokenRemoved);
expectAssignable<ContractEvent>(reputationUpdated);
expectAssignable<ContractEvent>(contractStatsUpdated);
expectAssignable<ContractEvent>(lpStatsUpdated);

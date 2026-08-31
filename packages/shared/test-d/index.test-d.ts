/**
 * Entry-point surface tests for `@iln/shared`.
 *
 * `packages/shared` is a dependency of the SDK, CLI, indexer, and notifications
 * service, so a type-level regression here breaks type-checking for every
 * consumer without failing a single runtime test. These files are the guard.
 *
 * This file covers the module boundary: every name `src/index.ts` re-exports is
 * importable, and each deprecated alias still resolves to the shape consumers
 * were promised. Per-type structural coverage lives in the sibling files
 * (`invoice`, `governance`, `reputation`, `token-and-stats`, `events`).
 */
import { expectAssignable, expectNotAssignable, expectType } from 'tsd';
import type {
  ContractEvent,
  ContractStats,
  ContractStatsUpdatedEvent,
  GovernanceProposal,
  GovernanceProposalCreatedEvent,
  GovernanceProposalExecutedEvent,
  GovernanceProposalVotedEvent,
  Invoice,
  InvoiceCreatedEvent,
  InvoiceDefaultedEvent,
  InvoiceFundedEvent,
  InvoicePaidEvent,
  InvoiceRepaidEvent,
  InvoiceState,
  InvoiceStatus,
  InvoiceSubmittedEvent,
  LPStats,
  LPStatsUpdatedEvent,
  ProposalAction,
  ProposalStatus,
  ReputationScore,
  ReputationUpdatedEvent,
  Token,
  TokenAddedEvent,
  TokenDelistedEvent,
  TokenListedEvent,
  TokenRemovedEvent,
  VoteCastEvent,
} from '@iln/shared';

// ─── Every export resolves to a usable type ───────────────────────────────────
//
// Referencing each import in a type position fails to compile if `src/index.ts`
// stops re-exporting it, which is the cheapest possible guard against an export
// being dropped during a refactor.

declare const invoice: Invoice;
declare const invoiceStatus: InvoiceStatus;
declare const invoiceState: InvoiceState;
declare const reputationScore: ReputationScore;
declare const governanceProposal: GovernanceProposal;
declare const proposalStatus: ProposalStatus;
declare const proposalAction: ProposalAction;
declare const token: Token;
declare const contractStats: ContractStats;
declare const lpStats: LPStats;

declare const contractEvent: ContractEvent;
declare const invoiceSubmitted: InvoiceSubmittedEvent;
declare const invoiceFunded: InvoiceFundedEvent;
declare const invoicePaid: InvoicePaidEvent;
declare const invoiceDefaulted: InvoiceDefaultedEvent;
declare const proposalCreated: GovernanceProposalCreatedEvent;
declare const voteCast: VoteCastEvent;
declare const proposalExecuted: GovernanceProposalExecutedEvent;
declare const tokenAdded: TokenAddedEvent;
declare const tokenRemoved: TokenRemovedEvent;
declare const reputationUpdated: ReputationUpdatedEvent;
declare const contractStatsUpdated: ContractStatsUpdatedEvent;
declare const lpStatsUpdated: LPStatsUpdatedEvent;

expectType<bigint>(invoice.id);
expectType<InvoiceStatus>(invoiceStatus);
expectType<number>(reputationScore.score);
expectType<bigint>(governanceProposal.id);
expectAssignable<string>(proposalStatus);
expectAssignable<ProposalAction['type']>(proposalAction.type);
expectType<string>(token.symbol);
expectType<bigint>(contractStats.totalInvoices);
expectType<number>(lpStats.avgYieldBps);
expectAssignable<ContractEvent>(contractEvent);

// ─── Deprecated aliases still resolve ─────────────────────────────────────────
//
// These are kept for backward compatibility. If one is ever removed it must be
// a deliberate breaking change, not an accident, so each is pinned here.

// InvoiceState is a straight alias, not a subset: it must accept every status.
expectType<InvoiceStatus>(invoiceState);
expectType<InvoiceState>(invoiceStatus);

declare const invoiceCreated: InvoiceCreatedEvent;
expectType<'InvoiceCreated'>(invoiceCreated.type);
expectType<Invoice>(invoiceCreated.invoice);

declare const invoiceRepaid: InvoiceRepaidEvent;
expectType<'InvoiceRepaid'>(invoiceRepaid.type);
expectType<bigint>(invoiceRepaid.lpPayout);

declare const proposalVoted: GovernanceProposalVotedEvent;
expectType<'ProposalVoted'>(proposalVoted.type);
expectType<boolean>(proposalVoted.support);

declare const tokenListed: TokenListedEvent;
expectType<'TokenListed'>(tokenListed.type);
expectType<Token>(tokenListed.token);

declare const tokenDelisted: TokenDelistedEvent;
expectType<'TokenDelisted'>(tokenDelisted.type);
expectType<Token>(tokenDelisted.token);

// ─── Deprecated events are outside the canonical union ────────────────────────
//
// The contract emits InvoiceSubmitted/InvoicePaid/VoteCast/TokenAdded/
// TokenRemoved. The aliases exist for consumers that adopted the old names, but
// widening ContractEvent to include them would let a consumer switch on a type
// tag the indexer will never emit.

expectNotAssignable<ContractEvent>(invoiceCreated);
expectNotAssignable<ContractEvent>(invoiceRepaid);
expectNotAssignable<ContractEvent>(proposalVoted);
expectNotAssignable<ContractEvent>(tokenListed);
expectNotAssignable<ContractEvent>(tokenDelisted);

// ─── Canonical events are inside it ───────────────────────────────────────────

expectAssignable<ContractEvent>(invoiceSubmitted);
expectAssignable<ContractEvent>(invoiceFunded);
expectAssignable<ContractEvent>(invoicePaid);
expectAssignable<ContractEvent>(invoiceDefaulted);
expectAssignable<ContractEvent>(proposalCreated);
expectAssignable<ContractEvent>(voteCast);
expectAssignable<ContractEvent>(proposalExecuted);
expectAssignable<ContractEvent>(tokenAdded);
expectAssignable<ContractEvent>(tokenRemoved);
expectAssignable<ContractEvent>(reputationUpdated);
expectAssignable<ContractEvent>(contractStatsUpdated);
expectAssignable<ContractEvent>(lpStatsUpdated);

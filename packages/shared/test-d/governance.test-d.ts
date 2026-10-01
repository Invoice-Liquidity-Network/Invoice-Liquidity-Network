/**
 * Type-level tests for the governance types: `ProposalStatus`, the
 * `ProposalAction` discriminated union, and the `GovernanceProposal` struct.
 *
 * `ProposalAction` is the one place in this package where narrowing behaviour
 * matters to consumers, so it is exercised rather than merely constructed.
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import type { GovernanceProposal, ProposalAction, ProposalStatus } from '@iln/shared';

// ─── ProposalStatus ───────────────────────────────────────────────────────────

expectAssignable<ProposalStatus>('Active');
expectAssignable<ProposalStatus>('Passed');
expectAssignable<ProposalStatus>('Rejected');
expectAssignable<ProposalStatus>('Executed');
expectAssignable<ProposalStatus>('Vetoed');

expectNotAssignable<ProposalStatus>('Pending');
expectNotAssignable<ProposalStatus>('active');

// ─── ProposalAction: all four variants ────────────────────────────────────────

expectAssignable<ProposalAction>({ type: 'UpdateFeeRate', value: 250 });
expectAssignable<ProposalAction>({ type: 'AddToken', value: 'CUSDC' });
expectAssignable<ProposalAction>({ type: 'RemoveToken', value: 'CEURC' });
expectAssignable<ProposalAction>({ type: 'UpdateMaxDiscountRate', value: 1500 });

// The discriminant pins the value type: bps actions carry a number, token
// actions carry an address.
expectError<ProposalAction>({ type: 'UpdateFeeRate', value: 'CUSDC' });
expectError<ProposalAction>({ type: 'AddToken', value: 250 });
expectError<ProposalAction>({ type: 'RemoveToken', value: 250 });
expectError<ProposalAction>({ type: 'UpdateMaxDiscountRate', value: '1500' });
expectError<ProposalAction>({ type: 'PauseContract', value: 1 });
expectError<ProposalAction>({ type: 'UpdateFeeRate' });

// ─── ProposalAction: narrowing ────────────────────────────────────────────────

declare const action: ProposalAction;

if (action.type === 'UpdateFeeRate') {
  expectType<number>(action.value);
} else if (action.type === 'AddToken') {
  expectType<string>(action.value);
} else if (action.type === 'RemoveToken') {
  expectType<string>(action.value);
} else {
  expectType<'UpdateMaxDiscountRate'>(action.type);
  expectType<number>(action.value);
}

// ─── GovernanceProposal ───────────────────────────────────────────────────────

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

expectType<bigint>(proposal.id);
expectType<string>(proposal.proposer);
expectType<Uint8Array>(proposal.descriptionHash);
expectType<ProposalAction>(proposal.actionType);
expectType<bigint>(proposal.proposedValue);
expectType<ProposalStatus>(proposal.status);
expectType<bigint>(proposal.votesFor);
expectType<bigint>(proposal.votesAgainst);
expectType<number>(proposal.createdAt);
expectType<number>(proposal.votingEndsAt);
expectType<number | null>(proposal.etaLedger);

// A passed proposal carries a timelock ledger.
expectAssignable<GovernanceProposal>({ ...proposal, status: 'Passed', etaLedger: 1_234_567 });

// ─── GovernanceProposal: invalid usage ────────────────────────────────────────

// The description is stored off-chain; only its hash is on-chain. The pre-audit
// shape carried title/description/abstainVotes, none of which the contract has.
expectError<GovernanceProposal>({ ...proposal, title: 'Lower fees' });
expectError<GovernanceProposal>({ ...proposal, description: 'Reduce protocol fees.' });
expectError<GovernanceProposal>({ ...proposal, abstainVotes: 0n });
expectError<GovernanceProposal>({ ...proposal, forVotes: 10n });

// descriptionHash is raw bytes, not a hex string.
expectError<GovernanceProposal>({ ...proposal, descriptionHash: 'ab12cd34' });

// i128 vote weights are bigint; u64/u32 timestamps and ledgers are number.
expectError<GovernanceProposal>({ ...proposal, votesFor: 10_000 });
expectError<GovernanceProposal>({ ...proposal, createdAt: 1_700_000_000n });
expectError<GovernanceProposal>({ ...proposal, etaLedger: undefined });

// Status and action are closed unions.
expectError<GovernanceProposal>({ ...proposal, status: 'Cancelled' });
expectError<GovernanceProposal>({ ...proposal, actionType: 'UpdateFeeRate' });

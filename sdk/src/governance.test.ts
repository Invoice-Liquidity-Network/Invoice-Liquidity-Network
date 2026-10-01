import { describe, expect, it, vi } from 'vitest';
import { Account, Keypair, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';

import {
  GovernanceClient,
  GOVERNANCE_TESTNET,
  GOVERNANCE_DEFAULT_MIN_QUORUM_BPS,
  GOVERNANCE_VOTING_PERIOD_SECS,
  GOVERNANCE_DEFAULT_MIN_PROPOSAL_BALANCE,
  GOVERNANCE_MAX_DELEGATION_DEPTH,
  GOVERNANCE_BPS_DENOMINATOR,
  ProposalActionKind,
  ProposalStatus,
  parseGovernanceProposalSimulation,
  parseGovernanceProposalListSimulation,
} from './governance';
import { GovernanceContractMethod } from './governance-constants';
import { extractContractCall } from './governance-utils';
import type { RpcServerLike } from './types';

const CONTRACT_ID = GOVERNANCE_TESTNET.contractId;
const NETWORK_PASSPHRASE = GOVERNANCE_TESTNET.networkPassphrase;

const DESCRIPTION_HASH = Buffer.alloc(32, 0x01);
const REASON_HASH = Buffer.alloc(32, 0xde);

function createClient(server: RpcServerLike) {
  return new GovernanceClient({
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: 'https://example.test',
    server,
  });
}

function createMockServer(accountAddress?: string): RpcServerLike {
  return {
    getAccount: vi
      .fn()
      .mockResolvedValue(new Account(accountAddress ?? Keypair.random().publicKey(), '12')),
    simulateTransaction: vi.fn(),
    prepareTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    pollTransaction: vi.fn(),
  };
}

function sampleProposalNative(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    proposer: Keypair.random().publicKey(),
    description_hash: DESCRIPTION_HASH,
    action_type: ['UpdateFeeRate', 200],
    proposed_value: 200n,
    status: 'Active',
    votes_for: 0n,
    votes_against: 0n,
    created_at: 1_700_000_000,
    voting_end: 1_700_259_200,
    eta_ledger: 0,
    ...overrides,
  };
}

describe('GovernanceClient', () => {
  it('builds createProposal transaction with correct contract call', async () => {
    const proposer = Keypair.random().publicKey();
    const server = createMockServer(proposer);
    const client = createClient(server);

    const transaction = await client.createProposal({
      proposer,
      action: { kind: ProposalActionKind.UpdateFeeRate, rate: 200 },
      descriptionHash: DESCRIPTION_HASH,
      proposedValue: 200n,
    });

    const call = extractContractCall(transaction);
    expect(call.contractId).toBe(CONTRACT_ID);
    expect(call.functionName).toBe(GovernanceContractMethod.CreateProposal);
    expect(scValToNative(call.args[0])).toBe(proposer);
    expect(scValToNative(call.args[1])).toEqual(['UpdateFeeRate', 200]);
    expect(Buffer.from(scValToNative(call.args[2]) as Buffer)).toEqual(DESCRIPTION_HASH);
    expect(scValToNative(call.args[3])).toBe(200n);
    expect(server.getAccount).toHaveBeenCalledWith(proposer);
  });

  it('builds castVote transaction with correct contract call', async () => {
    const voter = Keypair.random().publicKey();
    const server = createMockServer(voter);
    const client = createClient(server);

    const transaction = await client.castVote({
      voter,
      proposalId: 7n,
      support: true,
    });

    const call = extractContractCall(transaction);
    expect(call.functionName).toBe(GovernanceContractMethod.CastVote);
    expect(scValToNative(call.args[0])).toBe(voter);
    expect(scValToNative(call.args[1])).toBe(7n);
    expect(scValToNative(call.args[2])).toBe(true);
  });

  it('builds executeProposal transaction with correct contract call', async () => {
    const source = Keypair.random().publicKey();
    const server = createMockServer(source);
    const client = createClient(server);

    const transaction = await client.executeProposal({
      source,
      proposalId: 3n,
      totalSupply: 20_000n,
    });

    const call = extractContractCall(transaction);
    expect(call.functionName).toBe(GovernanceContractMethod.ExecuteProposal);
    expect(scValToNative(call.args[0])).toBe(3n);
    expect(scValToNative(call.args[1])).toBe(20_000n);
  });

  it('builds vetoProposal transaction with correct contract call', async () => {
    const admin = Keypair.random().publicKey();
    const server = createMockServer(admin);
    const client = createClient(server);

    const transaction = await client.vetoProposal({
      admin,
      proposalId: 1n,
      reasonHash: REASON_HASH,
    });

    const call = extractContractCall(transaction);
    expect(call.functionName).toBe(GovernanceContractMethod.VetoProposal);
    expect(scValToNative(call.args[0])).toBe(1n);
    expect(Buffer.from(scValToNative(call.args[1]) as Buffer)).toEqual(REASON_HASH);
  });

  it('builds delegateVotes transaction with correct contract call', async () => {
    const delegator = Keypair.random().publicKey();
    const delegate = Keypair.random().publicKey();
    const server = createMockServer(delegator);
    const client = createClient(server);

    const transaction = await client.delegateVotes({ delegator, delegate });

    const call = extractContractCall(transaction);
    expect(call.functionName).toBe(GovernanceContractMethod.DelegateVotes);
    expect(scValToNative(call.args[0])).toBe(delegator);
    expect(scValToNative(call.args[1])).toBe(delegate);
  });

  it('builds undelegateVotes transaction with correct contract call', async () => {
    const delegator = Keypair.random().publicKey();
    const server = createMockServer(delegator);
    const client = createClient(server);

    const transaction = await client.undelegateVotes({ delegator });

    const call = extractContractCall(transaction);
    expect(call.functionName).toBe(GovernanceContractMethod.UndelegateVotes);
    expect(scValToNative(call.args[0])).toBe(delegator);
  });

  it('builds getProposal read transaction with correct contract call', () => {
    const server = createMockServer();
    const client = createClient(server);

    const transaction = client.getProposal({ proposalId: 5n });
    const call = extractContractCall(transaction);

    expect(call.functionName).toBe(GovernanceContractMethod.GetProposal);
    expect(scValToNative(call.args[0])).toBe(5n);
    expect(server.getAccount).not.toHaveBeenCalled();
  });

  it('builds listProposals read transaction with status filter and pagination', () => {
    const server = createMockServer();
    const client = createClient(server);

    const transaction = client.listProposals({
      status: ProposalStatus.Active,
      page: 1,
      pageSize: 10,
    });
    const call = extractContractCall(transaction);

    expect(call.functionName).toBe(GovernanceContractMethod.ListProposals);
    expect(call.args[0].switch().name).toBe('scvSymbol');
    expect(call.args[0].sym().toString()).toBe('Active');
    expect(scValToNative(call.args[1])).toBe(1);
    expect(scValToNative(call.args[2])).toBe(10);
  });

  it('builds listProposals read transaction with void status filter by default', () => {
    const server = createMockServer();
    const client = createClient(server);

    const transaction = client.listProposals();
    const call = extractContractCall(transaction);

    expect(call.args[0].switch().name).toBe('scvVoid');
    expect(scValToNative(call.args[1])).toBe(0);
    expect(scValToNative(call.args[2])).toBe(20);
  });

  it('parses getProposal simulation into typed proposal data', async () => {
    const proposer = Keypair.random().publicKey();
    const server = createMockServer();

    const simulation = {
      result: {
        retval: nativeToScVal(sampleProposalNative({ proposer })),
      },
    };

    const proposal = parseGovernanceProposalSimulation(
      simulation,
      GovernanceContractMethod.GetProposal
    );

    expect(proposal.id).toBe(1n);
    expect(proposal.proposer).toBe(proposer);
    expect(proposal.status).toBe(ProposalStatus.Active);
    expect(proposal.action).toEqual({
      kind: ProposalActionKind.UpdateFeeRate,
      rate: 200,
    });
    expect(proposal.descriptionHash).toEqual(DESCRIPTION_HASH);
    expect(server.getAccount).not.toHaveBeenCalled();
  });

  it('parses listProposals simulation into typed proposal list', async () => {
    const server = createMockServer();
    const client = createClient(server);

    client.listProposals({ page: 0, pageSize: 10 });
    const simulation = {
      result: {
        retval: nativeToScVal([sampleProposalNative(), sampleProposalNative({ id: 2n })]),
      },
    };

    const proposals = parseGovernanceProposalListSimulation(
      simulation,
      GovernanceContractMethod.ListProposals
    );

    expect(proposals).toHaveLength(2);
    expect(proposals[0]?.id).toBe(1n);
    expect(proposals[1]?.id).toBe(2n);
  });

  it('propagates simulation errors from getProposal parsing', () => {
    expect(() =>
      parseGovernanceProposalSimulation(
        { error: 'contract reverted' },
        GovernanceContractMethod.GetProposal
      )
    ).toThrow('Simulation failed for get_proposal: contract reverted');
  });

  it('propagates contract errors from getProposal parsing', () => {
    expect(() =>
      parseGovernanceProposalSimulation(
        {
          result: {
            retval: nativeToScVal({ err: 'ProposalNotFound' }),
          },
        },
        GovernanceContractMethod.GetProposal
      )
    ).toThrow('Contract method get_proposal returned an error: ProposalNotFound.');
  });

  it('propagates contract errors from listProposals parsing', () => {
    expect(() =>
      parseGovernanceProposalListSimulation(
        {
          result: {
            retval: nativeToScVal({ Err: 2 }),
          },
        },
        GovernanceContractMethod.ListProposals
      )
    ).toThrow('Contract method list_proposals returned an error: 2.');
  });

  it('rejects invalid description hash length in parser', () => {
    expect(() =>
      parseGovernanceProposalSimulation(
        {
          result: {
            retval: nativeToScVal(
              sampleProposalNative({ description_hash: Buffer.alloc(16, 0x01) })
            ),
          },
        },
        GovernanceContractMethod.GetProposal
      )
    ).toThrow('Expected description hash to be 32 bytes.');
  });

  it('encodes add-token proposal actions', async () => {
    const proposer = Keypair.random().publicKey();
    const tokenAddress = Keypair.random().publicKey();
    const server = createMockServer(proposer);
    const client = createClient(server);

    const transaction = await client.createProposal({
      proposer,
      action: { kind: ProposalActionKind.AddToken, tokenAddress },
      descriptionHash: DESCRIPTION_HASH,
      proposedValue: 0n,
    });

    const call = extractContractCall(transaction);
    expect(scValToNative(call.args[1])).toEqual(['AddToken', tokenAddress]);
  });
});

describe('governance encoding helpers', () => {
  it('rejects non-32-byte hash values', async () => {
    const proposer = Keypair.random().publicKey();
    const server = createMockServer(proposer);
    const client = createClient(server);

    await expect(
      client.createProposal({
        proposer,
        action: { kind: ProposalActionKind.UpdateFeeRate, rate: 100 },
        descriptionHash: Buffer.alloc(16),
        proposedValue: 100n,
      })
    ).rejects.toThrow('Expected 32-byte hash but received 16 bytes.');
  });
});

describe('governance constants', () => {
  it('exports the correct default min quorum bps', () => {
    expect(GOVERNANCE_DEFAULT_MIN_QUORUM_BPS).toBe(1_000);
  });

  it('exports the correct bps denominator', () => {
    expect(GOVERNANCE_BPS_DENOMINATOR).toBe(10_000);
  });

  it('exports the correct voting period in seconds (3 days)', () => {
    expect(GOVERNANCE_VOTING_PERIOD_SECS).toBe(259_200);
  });

  it('exports the correct default min proposal balance', () => {
    expect(GOVERNANCE_DEFAULT_MIN_PROPOSAL_BALANCE).toBe(1_000n);
  });

  it('exports the correct max delegation depth', () => {
    expect(GOVERNANCE_MAX_DELEGATION_DEPTH).toBe(10);
  });
});

describe('GovernanceClient – read-only config queries', () => {
  it('builds getMinQuorumBps read transaction with correct method', () => {
    const server = createMockServer();
    const client = createClient(server);

    const transaction = client.getMinQuorumBps();
    const call = extractContractCall(transaction);

    expect(call.contractId).toBe(CONTRACT_ID);
    expect(call.functionName).toBe(GovernanceContractMethod.GetMinQuorumBps);
    expect(call.args).toHaveLength(0);
    expect(server.getAccount).not.toHaveBeenCalled();
  });

  it('builds getExecutionDelay read transaction with correct method', () => {
    const server = createMockServer();
    const client = createClient(server);

    const transaction = client.getExecutionDelay();
    const call = extractContractCall(transaction);

    expect(call.contractId).toBe(CONTRACT_ID);
    expect(call.functionName).toBe(GovernanceContractMethod.GetExecutionDelay);
    expect(call.args).toHaveLength(0);
    expect(server.getAccount).not.toHaveBeenCalled();
  });
});

describe('GovernanceClient – tallyVotes', () => {
  function makeProposal(
    votesFor: bigint,
    votesAgainst: bigint,
    overrides: Partial<ReturnType<typeof sampleProposalNative>> = {}
  ) {
    const proposer = Keypair.random().publicKey();
    return parseGovernanceProposalSimulation(
      {
        result: {
          retval: nativeToScVal(
            sampleProposalNative({
              proposer,
              votes_for: votesFor,
              votes_against: votesAgainst,
              ...overrides,
            })
          ),
        },
      },
      GovernanceContractMethod.GetProposal
    );
  }

  it('returns passed=true when quorum and majority are both met', () => {
    const client = createClient(createMockServer());
    const proposal = makeProposal(600n, 100n);

    const result = client.tallyVotes({ proposal, totalSupply: 1_000n });

    expect(result.proposalId).toBe(1n);
    expect(result.votesFor).toBe(600n);
    expect(result.votesAgainst).toBe(100n);
    expect(result.totalVotes).toBe(700n);
    // quorumThreshold = 1000 * 1000 / 10000 = 100
    expect(result.quorumThreshold).toBe(100n);
    expect(result.quorumMet).toBe(true);
    expect(result.majorityFor).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('returns passed=false when quorum is not met', () => {
    const client = createClient(createMockServer());
    const proposal = makeProposal(5n, 0n);

    const result = client.tallyVotes({ proposal, totalSupply: 10_000n });

    // quorumThreshold = 10000 * 1000 / 10000 = 1000; totalVotes = 5 < 1000
    expect(result.quorumMet).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('returns passed=false when majority votes against', () => {
    const client = createClient(createMockServer());
    const proposal = makeProposal(200n, 800n);

    const result = client.tallyVotes({ proposal, totalSupply: 1_000n });

    expect(result.quorumMet).toBe(true);
    expect(result.majorityFor).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('respects a custom minQuorumBps override', () => {
    const client = createClient(createMockServer());
    const proposal = makeProposal(300n, 0n);

    // With 50% quorum (5000 bps) and totalSupply 1000, threshold = 500 > 300 votes.
    const result = client.tallyVotes({ proposal, totalSupply: 1_000n, minQuorumBps: 5_000 });

    expect(result.quorumThreshold).toBe(500n);
    expect(result.quorumMet).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('handles zero totalSupply by setting quorumThreshold to 0 (always met)', () => {
    const client = createClient(createMockServer());
    const proposal = makeProposal(1n, 0n);

    const result = client.tallyVotes({ proposal, totalSupply: 0n });

    expect(result.quorumThreshold).toBe(0n);
    expect(result.quorumMet).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('returns majorityFor=false on tied votes', () => {
    const client = createClient(createMockServer());
    const proposal = makeProposal(500n, 500n);

    const result = client.tallyVotes({ proposal, totalSupply: 10_000n });

    expect(result.majorityFor).toBe(false);
    expect(result.passed).toBe(false);
  });
});

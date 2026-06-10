import type {
  CreateProposalPayload,
  GovernanceClient,
  Proposal,
  ProposalStatus,
  ProtocolParameters,
  VoteChoice,
} from "./types.js";

import { SEED_PROPOSALS, SEED_PROTOCOL_PARAMS } from "./seed.js";

function fakeTxHash(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
}

function delay(ms = 80): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory implementation of {@link GovernanceClient}.
 *
 * Voting state and proposals are kept in JS Maps. All mutating operations
 * (castVote, executeProposal, createProposal) update in-memory state so the
 * frontend can see real-time changes within a session without a live contract.
 */
export class MockGovernanceClient implements GovernanceClient {
  private readonly proposals: Map<number, Proposal>;
  private readonly userVotes: Map<number, VoteChoice>;
  private readonly protocolParams: ProtocolParameters;
  private readonly votingPower: number;

  constructor(options?: {
    proposals?: Proposal[];
    protocolParams?: ProtocolParameters;
    /** Simulated ILN token balance for the connected wallet (default 1,250). */
    votingPower?: number;
  }) {
    const seed = options?.proposals ?? SEED_PROPOSALS;
    this.proposals = new Map(seed.map((p) => [p.id, { ...p }]));
    this.userVotes = new Map();
    this.protocolParams = options?.protocolParams
      ? { ...options.protocolParams }
      : { ...SEED_PROTOCOL_PARAMS };
    this.votingPower = options?.votingPower ?? 1_250;
  }

  // ─── Reads ──────────────────────────────────────────────────────────────────

  async fetchProposals(): Promise<Proposal[]> {
    await delay(80);
    return [...this.proposals.values()].map((p) => ({
      ...p,
      userVote: this.userVotes.get(p.id),
    }));
  }

  async fetchProposal(id: number): Promise<Proposal | null> {
    await delay(60);
    const proposal = this.proposals.get(id);
    if (!proposal) return null;
    return { ...proposal, userVote: this.userVotes.get(id) };
  }

  async getVotingPower(_address: string): Promise<number> {
    await delay(60);
    return this.votingPower;
  }

  async fetchProtocolParameters(): Promise<ProtocolParameters> {
    await delay(80);
    return { ...this.protocolParams };
  }

  // ─── Writes ─────────────────────────────────────────────────────────────────

  async castVote(
    proposalId: number,
    choice: VoteChoice,
    _signerAddress: string
  ): Promise<string> {
    await delay(200);

    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    if (proposal.status !== "Active") {
      throw new Error(`Proposal ${proposalId} is not active (status: ${proposal.status})`);
    }
    if (this.userVotes.has(proposalId)) {
      throw new Error(`Already voted on proposal ${proposalId}`);
    }

    // Apply vote weight
    if (choice === "For") proposal.votesFor += this.votingPower;
    else if (choice === "Against") proposal.votesAgainst += this.votingPower;
    else proposal.votesAbstain += this.votingPower;

    this.proposals.set(proposalId, proposal);
    this.userVotes.set(proposalId, choice);

    return fakeTxHash();
  }

  async executeProposal(
    proposalId: number,
    _signerAddress: string
  ): Promise<string> {
    await delay(200);

    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    if (proposal.status !== "Passed") {
      throw new Error(`Proposal ${proposalId} cannot be executed (status: ${proposal.status})`);
    }

    proposal.status = "Executed" as ProposalStatus;
    this.proposals.set(proposalId, proposal);
    return fakeTxHash();
  }

  async createProposal(
    payload: CreateProposalPayload,
    signerAddress: string
  ): Promise<{ txHash: string; proposalId: number }> {
    await delay(300);

    const nowSec = Math.floor(Date.now() / 1000);
    const newId = Math.max(...this.proposals.keys(), 0) + 1;

    const newProposal: Proposal = {
      id: newId,
      title: payload.title,
      description: payload.description,
      type: payload.type,
      status: "Active",
      proposer: signerAddress,
      createdAt: nowSec,
      votingStartsAt: nowSec,
      votingEndsAt: nowSec + 7 * 86_400,
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      quorumRequired: 100_000,
      parameterChanges: payload.parameterChanges,
    };

    this.proposals.set(newId, newProposal);
    return { txHash: fakeTxHash(), proposalId: newId };
  }
}

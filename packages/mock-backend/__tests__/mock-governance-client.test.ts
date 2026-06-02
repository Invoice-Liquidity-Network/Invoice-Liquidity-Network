import { describe, it, expect, beforeEach } from "vitest";
import { MockGovernanceClient } from "../src/mock-governance-client.js";
import { CAROL } from "../src/seed.js";

function makeClient() {
  return new MockGovernanceClient();
}

describe("MockGovernanceClient — reads", () => {
  it("fetchProposals returns 6 seed proposals", async () => {
    const client = makeClient();
    const proposals = await client.fetchProposals();
    expect(proposals.length).toBeGreaterThanOrEqual(6);
  });

  it("fetchProposal returns correct proposal", async () => {
    const client = makeClient();
    const proposal = await client.fetchProposal(1);
    expect(proposal).not.toBeNull();
    expect(proposal!.id).toBe(1);
    expect(proposal!.status).toBe("Active");
  });

  it("fetchProposal returns null for unknown id", async () => {
    const client = makeClient();
    expect(await client.fetchProposal(9999)).toBeNull();
  });

  it("fetchProposals includes Active, Passed, Executed, Failed statuses", async () => {
    const client = makeClient();
    const proposals = await client.fetchProposals();
    const statuses = new Set(proposals.map((p) => p.status));
    expect(statuses).toContain("Active");
    expect(statuses).toContain("Passed");
    expect(statuses).toContain("Executed");
    expect(statuses).toContain("Failed");
  });

  it("getVotingPower returns default 1250", async () => {
    const client = makeClient();
    expect(await client.getVotingPower(CAROL)).toBe(1_250);
  });

  it("fetchProtocolParameters returns expected structure", async () => {
    const client = makeClient();
    const params = await client.fetchProtocolParameters();
    expect(params.feeRateBps).toBeGreaterThan(0);
    expect(params.maxDiscountRateBps).toBeGreaterThan(0);
    expect(params.acceptedTokens.length).toBeGreaterThan(0);
    expect(params.minProposalILN).toBeGreaterThan(0);
  });
});

describe("MockGovernanceClient — castVote", () => {
  it("castVote increments votesFor", async () => {
    const client = makeClient();
    const before = (await client.fetchProposal(1))!;
    await client.castVote(1, "For", CAROL);
    const after = (await client.fetchProposal(1))!;
    expect(after.votesFor).toBe(before.votesFor + 1_250);
    expect(after.userVote).toBe("For");
  });

  it("castVote increments votesAgainst", async () => {
    const client = makeClient();
    const before = (await client.fetchProposal(1))!;
    await client.castVote(1, "Against", CAROL);
    const after = (await client.fetchProposal(1))!;
    expect(after.votesAgainst).toBe(before.votesAgainst + 1_250);
  });

  it("castVote returns a tx hash string", async () => {
    const client = makeClient();
    const hash = await client.castVote(1, "Abstain", CAROL);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("castVote prevents double-voting", async () => {
    const client = makeClient();
    await client.castVote(1, "For", CAROL);
    await expect(client.castVote(1, "Against", CAROL)).rejects.toThrow(/Already voted/);
  });

  it("castVote rejects vote on non-Active proposal", async () => {
    const client = makeClient();
    // Proposal 4 is Executed
    await expect(client.castVote(4, "For", CAROL)).rejects.toThrow(/not active/);
  });
});

describe("MockGovernanceClient — executeProposal", () => {
  it("executeProposal transitions Passed → Executed", async () => {
    const client = makeClient();
    // Proposal 3 is Passed
    await client.executeProposal(3, CAROL);
    const proposal = await client.fetchProposal(3);
    expect(proposal!.status).toBe("Executed");
  });

  it("executeProposal rejects non-Passed proposal", async () => {
    const client = makeClient();
    await expect(client.executeProposal(1, CAROL)).rejects.toThrow(/cannot be executed/);
  });
});

describe("MockGovernanceClient — createProposal", () => {
  it("creates a new proposal and returns id + hash", async () => {
    const client = makeClient();
    const result = await client.createProposal(
      {
        title: "Test proposal",
        description: "A test",
        type: "TextProposal",
      },
      CAROL
    );
    expect(result.proposalId).toBeGreaterThan(0);
    expect(result.txHash).toHaveLength(64);
  });

  it("new proposal appears in fetchProposals", async () => {
    const client = makeClient();
    const { proposalId } = await client.createProposal(
      { title: "New one", description: "desc", type: "ParameterUpdate" },
      CAROL
    );
    const found = await client.fetchProposal(proposalId);
    expect(found).not.toBeNull();
    expect(found!.status).toBe("Active");
    expect(found!.proposer).toBe(CAROL);
  });
});

import { scValToNative } from "@stellar/stellar-sdk";

import {
  ProposalActionKind,
  ProposalStatus,
  type GovernanceProposal,
  type ProposalAction,
} from "./governance-types";
import { HASH_BYTE_LENGTH } from "./governance-constants";
import { extractSimulationRetval, unwrapContractResult } from "./governance-utils";

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (typeof value === "string") {
    return BigInt(value);
  }
  throw new Error(`Expected bigint-compatible value but received ${typeof value}.`);
}

function toNumber(value: unknown, field: string): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  throw new Error(`Expected numeric ${field} value but received ${typeof value}.`);
}

function toStringValue(value: unknown, field: string): string {
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Expected string ${field} value but received ${typeof value}.`);
}

function toBuffer(value: unknown, field: string): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === "string") {
    return Buffer.from(value, "hex");
  }
  throw new Error(`Expected bytes ${field} value but received ${typeof value}.`);
}

function parseProposalStatus(value: unknown): ProposalStatus {
  if (typeof value === "string") {
    return normalizeProposalStatus(value);
  }

  if (value && typeof value === "object") {
    const [key] = Object.keys(value as Record<string, unknown>);
    if (key) {
      return normalizeProposalStatus(key);
    }
  }

  throw new Error("Unable to parse proposal status from contract response.");
}

function normalizeProposalStatus(value: string): ProposalStatus {
  switch (value) {
    case ProposalStatus.Active:
    case ProposalStatus.Passed:
    case ProposalStatus.Rejected:
    case ProposalStatus.Executed:
    case ProposalStatus.Vetoed:
      return value;
    default:
      throw new Error(`Unknown proposal status "${value}".`);
  }
}

function parseProposalAction(value: unknown): ProposalAction {
  if (Array.isArray(value) && value.length >= 2) {
    const [tag, payload] = value;
    return parseProposalActionFromTag(String(tag), payload);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const [tag] = Object.keys(record);
    if (tag) {
      const payload = record[tag];
      return parseProposalActionFromTag(tag, Array.isArray(payload) ? payload[0] : payload);
    }
  }

  throw new Error("Unable to parse proposal action from contract response.");
}

function parseProposalActionFromTag(tag: string, payload: unknown): ProposalAction {
  switch (tag) {
    case ProposalActionKind.UpdateFeeRate:
      return {
        kind: ProposalActionKind.UpdateFeeRate,
        rate: toNumber(payload, "rate"),
      };
    case ProposalActionKind.AddToken:
      return {
        kind: ProposalActionKind.AddToken,
        tokenAddress: toStringValue(payload, "tokenAddress"),
      };
    case ProposalActionKind.RemoveToken:
      return {
        kind: ProposalActionKind.RemoveToken,
        tokenAddress: toStringValue(payload, "tokenAddress"),
      };
    case ProposalActionKind.UpdateMaxDiscountRate:
      return {
        kind: ProposalActionKind.UpdateMaxDiscountRate,
        rate: toNumber(payload, "rate"),
      };
    default:
      throw new Error(`Unknown proposal action "${tag}".`);
  }
}

export function parseGovernanceProposal(value: unknown): GovernanceProposal {
  const proposal = value as Record<string, unknown>;

  const descriptionHash = toBuffer(
    proposal.description_hash ?? proposal.descriptionHash,
    "descriptionHash",
  );
  if (descriptionHash.length !== HASH_BYTE_LENGTH) {
    throw new Error(`Expected description hash to be ${HASH_BYTE_LENGTH} bytes.`);
  }

  return {
    id: toBigInt(proposal.id),
    proposer: toStringValue(proposal.proposer, "proposer"),
    descriptionHash,
    action: parseProposalAction(proposal.action_type ?? proposal.actionType),
    proposedValue: toBigInt(proposal.proposed_value ?? proposal.proposedValue),
    status: parseProposalStatus(proposal.status),
    votesFor: toBigInt(proposal.votes_for ?? proposal.votesFor),
    votesAgainst: toBigInt(proposal.votes_against ?? proposal.votesAgainst),
    createdAt: toNumber(proposal.created_at ?? proposal.createdAt, "createdAt"),
    votingEnd: toNumber(proposal.voting_end ?? proposal.votingEnd, "votingEnd"),
    etaLedger: toNumber(proposal.eta_ledger ?? proposal.etaLedger, "etaLedger"),
  };
}

export function parseGovernanceProposalSimulation(
  simulation: unknown,
  method: string,
): GovernanceProposal {
  const retval = extractSimulationRetval(simulation, method);
  const native = unwrapContractResult(scValToNative(retval), method);
  return parseGovernanceProposal(native);
}

export function parseGovernanceProposalListSimulation(
  simulation: unknown,
  method: string,
): GovernanceProposal[] {
  const retval = extractSimulationRetval(simulation, method);
  const native = unwrapContractResult(scValToNative(retval), method);

  if (!Array.isArray(native)) {
    throw new Error(`Expected ${method} to return an array of proposals.`);
  }

  return native.map((entry) => parseGovernanceProposal(entry));
}

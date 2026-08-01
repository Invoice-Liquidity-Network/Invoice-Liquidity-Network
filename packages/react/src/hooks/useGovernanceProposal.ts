import { useQuery } from '@tanstack/react-query';
import { useILNClient } from '../context';

const proposalKeys = {
  all: ['governance', 'proposal'] as const,
  detail: (id: number) => [...proposalKeys.all, id] as const,
  latestLedger: ['governance', 'latest-ledger'] as const,
};

const LEDGER_SECONDS = 5;

type ProposalLike = Record<string, unknown>;

export interface GovernanceTimelockState {
  currentLedger: number | null;
  executionEtaLedger: number | null;
  timelockRemainingLedgers: number | null;
  timeUntilExecutionMs: number | null;
  timelockProgress: number;
  canExecute: boolean;
}

export interface UseGovernanceProposalResult {
  data: import('@invoice-liquidity/sdk').Proposal | undefined;
  isLoading: boolean;
  error: Error | null;
  isPolling: boolean;
  proposalStatus: string | null;
  currentLedger: number | null;
  executionEtaLedger: number | null;
  timelockRemainingLedgers: number | null;
  timeUntilExecutionMs: number | null;
  timelockProgress: number;
  canExecute: boolean;
  refetch: () => Promise<unknown>;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asProposalLike(value: unknown): ProposalLike | null {
  return value && typeof value === 'object' ? (value as ProposalLike) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readProposalStatus(proposal: ProposalLike | null): string | null {
  if (!proposal) {
    return null;
  }

  const status = readString(proposal.status);
  if (status) {
    return status;
  }

  if (proposal.executed === true) {
    return 'Executed';
  }

  if (proposal.vetoed === true) {
    return 'Vetoed';
  }

  if (proposal.rejected === true) {
    return 'Rejected';
  }

  if (proposal.passed === true) {
    return 'Passed';
  }

  if (proposal.active === true) {
    return 'Active';
  }

  return null;
}

function readExecutionEtaLedger(proposal: ProposalLike | null): number | null {
  if (!proposal) {
    return null;
  }

  return (
    toNumber(proposal.etaLedger) ??
    toNumber(proposal.eta_ledger) ??
    toNumber(proposal.executableAfter) ??
    toNumber(proposal.executable_after) ??
    null
  );
}

async function readLatestLedger(client: unknown): Promise<number | null> {
  const getter = (client as { getLatestLedger?: () => Promise<unknown> }).getLatestLedger;
  if (typeof getter !== 'function') {
    return null;
  }

  const latest = await getter.call(client);
  if (typeof latest === 'number' || typeof latest === 'bigint' || typeof latest === 'string') {
    return toNumber(latest);
  }

  if (latest && typeof latest === 'object') {
    const ledger = latest as ProposalLike;
    return (
      toNumber(ledger.sequence) ??
      toNumber(ledger.sequenceNumber) ??
      toNumber(ledger.ledgerSequence) ??
      toNumber(ledger.ledger) ??
      toNumber(ledger.latestLedger) ??
      null
    );
  }

  return null;
}

/**
 * Fetches a governance proposal and keeps it in sync with the chain.
 */
export function useGovernanceProposal(id: number): UseGovernanceProposalResult {
  const client = useILNClient();

  const proposalQuery = useQuery({
    queryKey: proposalKeys.detail(id),
    queryFn: () => client.getProposal(id as unknown as bigint),
    enabled: id > 0,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const latestLedgerQuery = useQuery({
    queryKey: proposalKeys.latestLedger,
    queryFn: () => readLatestLedger(client),
    enabled: id > 0,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const proposalLike = asProposalLike(proposalQuery.data);
  const proposalStatus = readProposalStatus(proposalLike);
  const executionEtaLedger = readExecutionEtaLedger(proposalLike);
  const currentLedger = latestLedgerQuery.data ?? null;

  const timelockRemainingLedgers =
    proposalStatus === 'Passed' && executionEtaLedger != null && currentLedger != null
      ? Math.max(0, executionEtaLedger - currentLedger)
      : null;

  const timeUntilExecutionMs =
    timelockRemainingLedgers != null ? timelockRemainingLedgers * LEDGER_SECONDS * 1_000 : null;

  const timelockProgress =
    proposalStatus === 'Passed' && executionEtaLedger != null && currentLedger != null && executionEtaLedger > 0
      ? Math.min(1, currentLedger / executionEtaLedger)
      : proposalStatus === 'Passed'
        ? 0
        : 1;

  const canExecute =
    proposalStatus === 'Passed' &&
    executionEtaLedger != null &&
    currentLedger != null &&
    currentLedger >= executionEtaLedger;

  const isPolling =
    proposalQuery.isFetching || latestLedgerQuery.isFetching;

  return {
    data: proposalQuery.data,
    isLoading: proposalQuery.isLoading || latestLedgerQuery.isLoading,
    error:
      proposalQuery.error instanceof Error
        ? proposalQuery.error
        : latestLedgerQuery.error instanceof Error
          ? latestLedgerQuery.error
          : null,
    isPolling,
    proposalStatus,
    currentLedger,
    executionEtaLedger,
    timelockRemainingLedgers,
    timeUntilExecutionMs,
    timelockProgress,
    canExecute,
    refetch: async () => {
      const result = await proposalQuery.refetch();
      await latestLedgerQuery.refetch();
      return result;
    },
  };
}

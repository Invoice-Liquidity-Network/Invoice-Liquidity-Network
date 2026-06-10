import { useQuery } from '@tanstack/react-query';
import { useILNClient } from '../context';

const proposalKeys = {
  all: ['proposals'] as const,
  detail: (id: number) => [...proposalKeys.all, 'detail', id] as const,
};

export interface UseGovernanceProposalResult {
  data: import('@invoice-liquidity/sdk').Proposal | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetches a governance proposal by ID.
 * 
 * @param id - The proposal ID
 * @returns {UseGovernanceProposalResult} Proposal data, loading state, and error
 * 
 * @example
 * ```tsx
 * function ProposalCard({ id }: { id: number }) {
 *   const { data: proposal, isLoading } = useGovernanceProposal(id);
 *   
 *   if (isLoading) return <Spinner />;
 *   
 *   return (
 *     <div>
 *       <h3>Proposal #{proposal?.id}</h3>
 *       <p>For: {proposal?.votesFor}</p>
 *       <p>Against: {proposal?.votesAgainst}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useGovernanceProposal(id: number): UseGovernanceProposalResult {
  const client = useILNClient();

  const { data, isLoading, error } = useQuery({
    queryKey: proposalKeys.detail(id),
    queryFn: () => client.getProposal(id),
    enabled: id > 0,
    staleTime: 30_000,
  });

  return {
    data,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}
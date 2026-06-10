import { useQuery } from '@tanstack/react-query';
import { useILNClient } from '../context';

const reputationKeys = {
  all: ['reputation'] as const,
  detail: (address: string) => [...reputationKeys.all, address] as const,
};

export interface UseReputationScoreResult {
  data: import('@invoice-liquidity/sdk').ReputationScore | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetches the on-chain reputation score for a given address.
 * 
 * @param address - The Stellar address to check
 * @returns {UseReputationScoreResult} Reputation data, loading state, and error
 * 
 * @example
 * ```tsx
 * function TrustBadge({ address }: { address: string }) {
 *   const { data: rep } = useReputationScore(address);
 *   if (!rep) return null;
 *   
 *   return <Badge score={rep.score} />;
 * }
 * ```
 */
export function useReputationScore(address: string): UseReputationScoreResult {
  const client = useILNClient();

  const { data, isLoading, error } = useQuery({
    queryKey: reputationKeys.detail(address),
    queryFn: () => client.getReputationScore(address),
    enabled: !!address && address.startsWith('G'),
    staleTime: 60_000, // 1 minute — reputation changes infrequently
  });

  return {
    data,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}
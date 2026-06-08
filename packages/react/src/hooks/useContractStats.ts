import { useQuery } from '@tanstack/react-query';
import { useILNClient } from '../context';

const statsKeys = {
  all: ['stats'] as const,
};

export interface UseContractStatsResult {
  data: import('@invoice-liquidity/sdk').ContractStats | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetches global protocol statistics.
 * 
 * @returns {UseContractStatsResult} Protocol stats, loading state, and error
 * 
 * @example
 * ```tsx
 * function ProtocolStats() {
 *   const { data: stats } = useContractStats();
 *   
 *   return (
 *     <div>
 *       <Stat label="TVL" value={stats?.totalValueLocked} />
 *       <Stat label="Total Invoices" value={stats?.totalInvoices} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useContractStats(): UseContractStatsResult {
  const client = useILNClient();

  const { data, isLoading, error } = useQuery({
    queryKey: statsKeys.all,
    queryFn: () => client.getContractStats(),
    staleTime: 60_000,
  });

  return {
    data,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}
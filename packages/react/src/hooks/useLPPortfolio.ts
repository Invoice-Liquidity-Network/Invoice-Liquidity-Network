import { useQuery } from '@tanstack/react-query';
import { useILNClient } from '../context';

const portfolioKeys = {
  all: ['portfolio'] as const,
  detail: (address: string) => [...portfolioKeys.all, address] as const,
};

export interface UseLPPortfolioResult {
  data: import('@invoice-liquidity/sdk').LPPortfolio | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetches the liquidity provider portfolio for a given address.
 * 
 * @param address - The LP's Stellar address
 * @returns {UseLPPortfolioResult} Portfolio data, loading state, and error
 * 
 * @example
 * ```tsx
 * function LPDashboard({ address }: { address: string }) {
 *   const { data: portfolio, isLoading } = useLPPortfolio(address);
 *   
 *   if (isLoading) return <Spinner />;
 *   
 *   return (
 *     <div>
 *       <Stat label="Total Invested" value={portfolio?.totalInvested} />
 *       <Stat label="Total Yield" value={portfolio?.totalYield} />
 *       <Stat label="Active Positions" value={portfolio?.activePositions} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useLPPortfolio(address: string): UseLPPortfolioResult {
  const client = useILNClient();

  const { data, isLoading, error } = useQuery({
    queryKey: portfolioKeys.detail(address),
    queryFn: () => client.getLPPortfolio(address),
    enabled: !!address && address.startsWith('G'),
    staleTime: 30_000,
  });

  return {
    data,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}
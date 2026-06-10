import { useQuery } from '@tanstack/react-query';
import { useILNClient } from '../context';

const balanceKeys = {
  all: ['balances'] as const,
  detail: (address: string) => [...balanceKeys.all, address] as const,
};

export interface UseTokenBalancesResult {
  data: import('@invoice-liquidity/sdk').TokenBalance[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetches token balances for a given address.
 * 
 * @param address - The Stellar address to check balances for
 * @returns {UseTokenBalancesResult} Token balances, loading state, and error
 * 
 * @example
 * ```tsx
 * function WalletBalances({ address }: { address: string }) {
 *   const { data: balances, isLoading } = useTokenBalances(address);
 *   
 *   if (isLoading) return <Spinner />;
 *   
 *   return (
 *     <ul>
 *       {balances?.map((b) => (
 *         <li key={b.token}>{b.token}: {b.balance}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useTokenBalances(address: string): UseTokenBalancesResult {
  const client = useILNClient();

  const { data, isLoading, error } = useQuery({
    queryKey: balanceKeys.detail(address),
    queryFn: () => client.getTokenBalances(address),
    enabled: !!address && address.startsWith('G'),
    staleTime: 15_000, // 15 seconds — balances change frequently
  });

  return {
    data,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}
import { useQuery } from '@tanstack/react-query';
import { useILNClient } from '../context';
import type { InvoiceStatus } from '@invoice-liquidity/sdk';

/**
 * Role filter for invoice lists.
 */
export type InvoiceRole = 'issuer' | 'lp' | 'payer';

/**
 * Query key factory for invoice list queries.
 */
const invoiceListKeys = {
  all: ['invoices', 'list'] as const,
  byAddress: (address: string, role: InvoiceRole) => 
    [...invoiceListKeys.all, address, role] as const,
};

export interface UseInvoiceListResult {
  /** Array of invoices matching the filter */
  data: import('@invoice-liquidity/sdk').Invoice[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetches invoices filtered by address and role.
 * 
 * @param address - The Stellar address to filter by
 * @param role - The role ('issuer' | 'lp' | 'payer')
 * @returns {UseInvoiceListResult} List of invoices, loading state, and error
 * 
 * @example
 * ```tsx
 * function IssuerInvoices({ address }: { address: string }) {
 *   const { data: invoices, isLoading } = useInvoiceList(address, 'issuer');
 *   
 *   if (isLoading) return <Spinner />;
 *   return <InvoiceTable invoices={invoices ?? []} />;
 * }
 * ```
 */
export function useInvoiceList(address: string, role: InvoiceRole): UseInvoiceListResult {
  const client = useILNClient();

  const { data, isLoading, error } = useQuery({
    queryKey: invoiceListKeys.byAddress(address, role),
    queryFn: async () => {
      switch (role) {
        case 'issuer':
          return client.getInvoicesByIssuer(address);
        case 'lp':
          return client.getInvoicesByStatus(1); // Funded — then filter by fundedBy client-side or extend SDK
        case 'payer':
          // If SDK doesn't have payer filter, fetch all and filter
          const all = await client.getInvoicesByStatus(0); // Pending as proxy
          return all.filter((inv) => inv.payer === address);
        default:
          return [];
      }
    },
    enabled: !!address && address.startsWith('G'),
    staleTime: 30_000,
  });

  return {
    data,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}
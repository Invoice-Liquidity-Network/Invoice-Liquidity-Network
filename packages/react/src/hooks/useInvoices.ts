import { useQuery } from '@tanstack/react-query';
import { useILNClient } from '../context';
import type { InvoiceRole } from './useInvoiceList';

export type { InvoiceRole };

export interface UseInvoicesOptions {
  role?: InvoiceRole;
  page?: number;
  pageSize?: number;
}

export interface UseInvoicesResult {
  data: import('@iln/sdk').Invoice[] | undefined;
  totalCount: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isLoading: boolean;
  error: Error | null;
}

const invoicesKeys = {
  all: ['invoices', 'paginated'] as const,
  list: (address: string, role: InvoiceRole) => [...invoicesKeys.all, address, role] as const,
};

/**
 * Fetches a paginated list of invoices filtered by address and role.
 *
 * @param address - The Stellar address to filter by
 * @param options - Optional role, page, and pageSize controls
 * @returns {UseInvoicesResult} Paginated invoices, pagination metadata, loading state, and error
 *
 * @example
 * ```tsx
 * function InvoiceListPage({ address }: { address: string }) {
 *   const [page, setPage] = React.useState(1);
 *   const { data, hasNextPage, hasPreviousPage } = useInvoices(address, {
 *     role: 'issuer',
 *     page,
 *     pageSize: 5,
 *   });
 *
 *   return (
 *     <>
 *       <InvoiceTable invoices={data ?? []} />
 *       <button disabled={!hasPreviousPage} onClick={() => setPage((p) => p - 1)}>Prev</button>
 *       <button disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}>Next</button>
 *     </>
 *   );
 * }
 * ```
 */
export function useInvoices(address: string, options: UseInvoicesOptions = {}): UseInvoicesResult {
  const { role = 'issuer', page = 1, pageSize = 10 } = options;
  const client = useILNClient();

  const {
    data: allData,
    isLoading,
    error,
  } = useQuery({
    queryKey: invoicesKeys.list(address, role),
    queryFn: async () => {
      switch (role) {
        case 'issuer':
          return client.getInvoicesByIssuer(address);
        case 'lp':
          return client.getInvoicesByStatus('Funded');
        case 'payer': {
          const all = await client.getInvoicesByStatus('Pending');
          return all.filter((inv) => inv.payer === address);
        }
        default:
          return [];
      }
    },
    enabled: !!address && address.startsWith('G'),
    staleTime: 30_000,
  });

  const totalCount = allData?.length ?? 0;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const data = allData?.slice(start, end);

  return {
    data,
    totalCount,
    page,
    pageSize,
    hasNextPage: end < totalCount,
    hasPreviousPage: page > 1,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}

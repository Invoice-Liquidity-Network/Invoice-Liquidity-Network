import { useQuery } from '@tanstack/react-query';
import { useILNClient } from '../context';

/**
 * Query key factory for invoice queries.
 */
const invoiceKeys = {
  all: ['invoices'] as const,
  detail: (id: number) => [...invoiceKeys.all, 'detail', id] as const,
};

export interface UseInvoiceResult {
  /** The invoice data, or undefined if not yet loaded */
  data: import('@invoice-liquidity/sdk').Invoice | undefined;
  /** True during initial fetch */
  isLoading: boolean;
  /** Error if the fetch failed */
  error: Error | null;
}

/**
 * Fetches a single invoice by ID.
 * 
 * @param id - The invoice ID to fetch
 * @returns {UseInvoiceResult} Invoice data, loading state, and error
 * 
 * @example
 * ```tsx
 * function InvoiceCard({ id }: { id: number }) {
 *   const { data: invoice, isLoading, error } = useInvoice(id);
 *   
 *   if (isLoading) return <Spinner />;
 *   if (error) return <Error message={error.message} />;
 *   if (!invoice) return <NotFound />;
 *   
 *   return <div>Invoice #{invoice.id}: {invoice.status}</div>;
 * }
 * ```
 */
export function useInvoice(id: number): UseInvoiceResult {
  const client = useILNClient();

  const { data, isLoading, error } = useQuery({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => client.getInvoice(id),
    enabled: id > 0,
    staleTime: 30_000, // 30 seconds
  });

  return {
    data,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}
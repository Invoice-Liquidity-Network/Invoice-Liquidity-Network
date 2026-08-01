import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useILNClient } from '../context';

export interface FundInvoiceParams {
  invoiceId: number;
  funder: string;
  /**
   * Displayed Dutch-auction discount at the moment the LP chooses to fund.
   * Current contracts compute the canonical rate inside fund_invoice; clients
   * that support slippage checks can use this as the LP's expected rate.
   */
  expectedDiscountBps?: number;
}

export interface UseFundInvoiceResult {
  fundInvoice: (params: FundInvoiceParams) => Promise<void>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

/**
 * Mutation hook for funding an existing invoice.
 *
 * Automatically invalidates invoice queries on success so UIs stay in sync.
 * Applies an optimistic update (status → Funded) immediately and rolls back on error.
 *
 * @returns {UseFundInvoiceResult} Fund function, pending state, and error
 *
 * @example
 * ```tsx
 * function FundButton({ invoiceId }: { invoiceId: number }) {
 *   const { fundInvoice, isPending, error } = useFundInvoice();
 *
 *   return (
 *     <>
 *       {error && <p className="error">{error.message}</p>}
 *       <button
 *         disabled={isPending}
 *         onClick={() => fundInvoice({ invoiceId, funder: myAddress })}
 *       >
 *         {isPending ? 'Funding…' : 'Fund Invoice'}
 *       </button>
 *     </>
 *   );
 * }
 * ```
 */
export function useFundInvoice(): UseFundInvoiceResult {
  const client = useILNClient();
  const queryClient = useQueryClient();

  const { mutateAsync, isPending, error, reset } = useMutation<
    void,
    Error,
    FundInvoiceParams,
    { previous: unknown }
  >({
    mutationFn: (params: FundInvoiceParams): Promise<void> =>
      (client as unknown as { fundInvoice(p: FundInvoiceParams): Promise<void> })
        .fundInvoice(params),

    onMutate: async (params: FundInvoiceParams) => {
      const queryKey = ['invoices', 'detail', params.invoiceId];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old: unknown) =>
        old && typeof old === 'object' ? { ...old, status: 'Funded' } : old,
      );
      return { previous };
    },

    onError: (_err, params, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          ['invoices', 'detail', params.invoiceId],
          context.previous,
        );
      }
    },

    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });

  return {
    fundInvoice: mutateAsync,
    isPending,
    error: error instanceof Error ? error : null,
    reset,
  };
}

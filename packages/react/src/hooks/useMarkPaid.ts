import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useILNClient } from '../context';

export interface MarkPaidParams {
  invoiceId: number;
}

export interface UseMarkPaidResult {
  markPaid: (params: MarkPaidParams) => Promise<void>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

/**
 * Mutation hook for marking an invoice as paid.
 *
 * Automatically invalidates invoice queries on success so UIs stay in sync.
 *
 * @returns {UseMarkPaidResult} MarkPaid function, pending state, and error
 *
 * @example
 * ```tsx
 * function MarkPaidButton({ invoiceId }: { invoiceId: number }) {
 *   const { markPaid, isPending, error } = useMarkPaid();
 *
 *   return (
 *     <>
 *       {error && <p className="error">{error.message}</p>}
 *       <button
 *         disabled={isPending}
 *         onClick={() => markPaid({ invoiceId })}
 *       >
 *         {isPending ? 'Marking paid…' : 'Mark as Paid'}
 *       </button>
 *     </>
 *   );
 * }
 * ```
 */
export function useMarkPaid(): UseMarkPaidResult {
  const client = useILNClient();
  const queryClient = useQueryClient();

  const { mutateAsync, isPending, error, reset } = useMutation<void, Error, MarkPaidParams>({
    mutationFn: (params: MarkPaidParams): Promise<void> =>
      (client as unknown as { markPaid(p: MarkPaidParams): Promise<void> }).markPaid(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });

  return {
    markPaid: mutateAsync,
    isPending,
    error: error instanceof Error ? error : null,
    reset,
  };
}

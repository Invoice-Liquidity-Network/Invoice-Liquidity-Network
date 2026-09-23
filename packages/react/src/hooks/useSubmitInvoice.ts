import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useILNClient } from '../context';

export interface SubmitInvoiceParams {
  issuer: string;
  payer: string;
  amount: number;
  discountRate: number;
  dueDate: number;
}

export interface UseSubmitInvoiceResult {
  submitInvoice: (params: SubmitInvoiceParams) => Promise<unknown>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

/**
 * Mutation hook for submitting a new invoice to the contract.
 *
 * Automatically invalidates invoice list queries on success.
 *
 * @returns {UseSubmitInvoiceResult} Submit function, pending state, and error
 *
 * @example
 * ```tsx
 * function SubmitInvoiceForm() {
 *   const { submitInvoice, isPending, error } = useSubmitInvoice();
 *
 *   const handleSubmit = async (data: FormData) => {
 *     const id = await submitInvoice({
 *       issuer: data.issuer,
 *       payer: data.payer,
 *       amount: data.amount,
 *       discountRate: 300,
 *       dueDate: Date.now() / 1000 + 30 * 86400,
 *     });
 *     console.log('Invoice submitted, id:', id);
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       {error && <p className="error">{error.message}</p>}
 *       <button type="submit" disabled={isPending}>
 *         {isPending ? 'Submitting…' : 'Submit Invoice'}
 *       </button>
 *     </form>
 *   );
 * }
 * ```
 */
export function useSubmitInvoice(): UseSubmitInvoiceResult {
  const client = useILNClient();
  const queryClient = useQueryClient();

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (params: SubmitInvoiceParams): Promise<unknown> =>
      (
        client as unknown as { submitInvoice(p: SubmitInvoiceParams): Promise<unknown> }
      ).submitInvoice(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });

  return {
    submitInvoice: mutateAsync,
    isPending,
    error: error instanceof Error ? error : null,
    reset,
  };
}

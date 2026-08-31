import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useILNClient } from '../context';
import type { BatchResult, BatchSubmitParams } from '@iln/sdk';

export interface BatchInvoiceInput {
  freelancer: string;
  payer: string;
  amount: bigint;
  dueDate: number;
  discountRate: number;
  token?: string;
}

export type InvoiceStatus = 'pending' | 'submitting' | 'success' | 'failed';

export interface InvoiceProgress {
  index: number;
  payer: string;
  amount: bigint;
  discountRate: number;
  dueDate: number;
  status: InvoiceStatus;
  error?: string;
  invoiceId?: bigint;
}

export interface BatchProgress {
  invoices: InvoiceProgress[];
  totalCount: number;
  completedCount: number;
  successCount: number;
  failedCount: number;
  isComplete: boolean;
  isProcessing: boolean;
  startedAt: number;
}

export interface UseBatchSubmitInvoiceResult {
  submitBatch: (invoices: BatchInvoiceInput[]) => Promise<BatchResult>;
  batchProgress: BatchProgress | null;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
  retryFailed: () => Promise<void>;
  failedInvoices: BatchInvoiceInput[];
}

function createInitialProgress(invoices: BatchInvoiceInput[]): BatchProgress {
  return {
    invoices: invoices.map((inv, i) => ({
      index: i,
      payer: inv.payer,
      amount: inv.amount,
      discountRate: inv.discountRate,
      dueDate: inv.dueDate,
      status: 'pending' as InvoiceStatus,
    })),
    totalCount: invoices.length,
    completedCount: 0,
    successCount: 0,
    failedCount: 0,
    isComplete: false,
    isProcessing: false,
    startedAt: Date.now(),
  };
}

function updateProgress(
  prev: BatchProgress,
  index: number,
  update: Partial<InvoiceProgress>
): BatchProgress {
  const invoices = prev.invoices.map((inv, i) => (i === index ? { ...inv, ...update } : inv));
  const completedCount = invoices.filter(
    (inv) => inv.status === 'success' || inv.status === 'failed'
  ).length;
  const successCount = invoices.filter((inv) => inv.status === 'success').length;
  const failedCount = invoices.filter((inv) => inv.status === 'failed').length;
  return {
    ...prev,
    invoices,
    completedCount,
    successCount,
    failedCount,
    isComplete: completedCount === prev.totalCount,
    isProcessing: completedCount < prev.totalCount && completedCount > 0,
  };
}

export function useBatchSubmitInvoice(): UseBatchSubmitInvoiceResult {
  const client = useILNClient();
  const queryClient = useQueryClient();
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);

  const {
    mutateAsync,
    isPending,
    error,
    reset: resetMutation,
  } = useMutation({
    mutationFn: async (params: BatchSubmitParams) => {
      return (
        client as unknown as { batchSubmitInvoices(p: BatchSubmitParams): Promise<BatchResult> }
      ).batchSubmitInvoices(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  const submitBatch = useCallback(
    async (invoices: BatchInvoiceInput[]): Promise<BatchResult> => {
      if (invoices.length === 0) {
        throw new Error('No invoices to submit');
      }
      if (invoices.length > 10) {
        throw new Error('Maximum 10 invoices per batch');
      }

      const progress = createInitialProgress(invoices);
      progress.invoices = progress.invoices.map((inv) => ({
        ...inv,
        status: 'submitting' as InvoiceStatus,
      }));
      setBatchProgress(progress);

      const params: BatchSubmitParams = {
        invoices: invoices.map((inv) => ({
          freelancer: inv.freelancer,
          payer: inv.payer,
          amount: inv.amount,
          dueDate: inv.dueDate,
          discountRate: inv.discountRate,
        })),
      };

      let batchResult: BatchResult;
      try {
        batchResult = await mutateAsync(params);
      } catch (err) {
        setBatchProgress((prev) => {
          if (!prev) return prev;
          let p = prev;
          for (let i = 0; i < invoices.length; i++) {
            p = updateProgress(p, i, {
              status: 'failed',
              error: err instanceof Error ? err.message : 'Submission failed',
            });
          }
          return p;
        });
        throw err;
      }

      setBatchProgress((prev) => {
        if (!prev) return prev;
        let p = prev;
        for (const result of batchResult.results) {
          const idx = result.index;
          if (result.success) {
            p = updateProgress(p, idx, {
              status: 'success',
              invoiceId: result.invoiceId,
            });
          } else {
            p = updateProgress(p, idx, {
              status: 'failed',
              error: result.error ?? 'Unknown error',
            });
          }
        }
        return p;
      });

      return batchResult;
    },
    [mutateAsync]
  );

  const retryFailed = useCallback(async (): Promise<void> => {
    setBatchProgress((prev) => {
      if (!prev) return prev;
      const failed = prev.invoices.filter((inv) => inv.status === 'failed');
      if (failed.length === 0) return prev;
      let p = prev;
      for (const inv of failed) {
        p = updateProgress(p, inv.index, {
          status: 'submitting',
          error: undefined,
        });
      }
      return p;
    });

    const currentProgress = batchProgress;
    if (!currentProgress) return;

    const failed = currentProgress.invoices.filter((inv) => inv.status === 'failed');
    if (failed.length === 0) return;

    const freelancer = failed[0].payer.startsWith('G') ? failed[0].payer : 'G';

    const failedInputs: BatchInvoiceInput[] = failed.map((inv) => ({
      freelancer,
      payer: inv.payer,
      amount: inv.amount,
      discountRate: inv.discountRate,
      dueDate: inv.dueDate,
    }));

    try {
      const result = await submitBatch(failedInputs);
      setBatchProgress((prev) => {
        if (!prev) return prev;
        let p = prev;
        for (const r of result.results) {
          const originalIdx = failed[r.index]?.index;
          if (originalIdx !== undefined) {
            p = updateProgress(p, originalIdx, {
              status: r.success ? 'success' : 'failed',
              error: r.error,
              invoiceId: r.invoiceId,
            });
          }
        }
        return p;
      });
    } catch {
      // submitBatch already updates state on error
    }
  }, [batchProgress, submitBatch]);

  const reset = useCallback((): void => {
    setBatchProgress(null);
    resetMutation();
  }, [resetMutation]);

  const failedInvoices: BatchInvoiceInput[] = batchProgress
    ? batchProgress.invoices
        .filter((inv) => inv.status === 'failed')
        .map((inv) => ({
          freelancer: inv.payer.startsWith('G') ? inv.payer : 'G',
          payer: inv.payer,
          amount: inv.amount,
          discountRate: inv.discountRate,
          dueDate: inv.dueDate,
        }))
    : [];

  return {
    submitBatch,
    batchProgress,
    isPending,
    error: error instanceof Error ? error : null,
    reset,
    retryFailed,
    failedInvoices,
  };
}

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Invoice, LPPortfolio } from '@invoice-liquidity/sdk';
import { useILNClient } from '../context';
import { useInvoiceList } from './useInvoiceList';
import { useLPPortfolio } from './useLPPortfolio';
import { calculateLPRiskMetrics, type LPRiskMetrics } from './lpRiskMetrics';

export interface UseLPRiskMetricsOptions {
  portfolio?: LPPortfolio;
  invoices?: Invoice[];
  reputationByPayer?: Record<string, number>;
  simulations?: number;
}

export interface UseLPRiskMetricsResult {
  data: LPRiskMetrics | undefined;
  isLoading: boolean;
  error: Error | null;
}

const riskMetricsKeys = {
  all: ['lp-risk'] as const,
  detail: (address: string) => [...riskMetricsKeys.all, address] as const,
};

export function useLPRiskMetrics(
  address: string,
  options: UseLPRiskMetricsOptions = {},
): UseLPRiskMetricsResult {
  const client = useILNClient();
  const portfolioAddress = options.portfolio ? '' : address;
  const invoiceAddress = options.invoices ? '' : address;

  const portfolioQuery = useLPPortfolio(portfolioAddress);
  const invoiceListQuery = useInvoiceList(invoiceAddress, 'lp');

  const resolvedPortfolio = options.portfolio ?? portfolioQuery.data;
  const rawInvoices = options.invoices ?? invoiceListQuery.data;

  const invoicePositions = useMemo(() => {
    const invoices = rawInvoices ?? [];
    return invoices.filter((invoice) => {
      const record = invoice as Record<string, unknown>;
      const fundedBy = String(record.fundedBy ?? record.funder ?? '');
      return fundedBy.length === 0 || fundedBy === address;
    });
  }, [rawInvoices, address]);

  const payerAddresses = useMemo(() => {
    const unique = new Set<string>();
    for (const invoice of invoicePositions) {
      const payer = String((invoice as Record<string, unknown>).payer ?? '');
      if (payer) {
        unique.add(payer);
      }
    }
    return [...unique];
  }, [invoicePositions]);

  const reputationByPayer = useMemo(() => {
    return new Map(Object.entries(options.reputationByPayer ?? {}));
  }, [options.reputationByPayer]);

  const shouldFetchReputation = payerAddresses.length > 0 && reputationByPayer.size !== payerAddresses.length;
  const reputationQueries = useQueries({
    queries: shouldFetchReputation
      ? payerAddresses.map((payer) => ({
          queryKey: riskMetricsKeys.detail(payer),
          queryFn: () => client.getReputationScore(payer),
          enabled: !!payer && payer.startsWith('G') && !reputationByPayer.has(payer),
          staleTime: 60_000,
        }))
      : [],
  });

  const resolvedReputationByPayer = useMemo(() => {
    const next = new Map(reputationByPayer);
    if (shouldFetchReputation) {
      payerAddresses.forEach((payer, index) => {
        const query = reputationQueries[index];
        if (query?.data !== undefined) {
          next.set(payer, query.data);
        }
      });
    }
    return next;
  }, [payerAddresses, reputationByPayer, reputationQueries, shouldFetchReputation]);

  const data = useMemo(() => {
    if (!resolvedPortfolio && invoicePositions.length === 0) {
      return undefined;
    }

    return calculateLPRiskMetrics({
      address,
      invoices: invoicePositions,
      portfolio: resolvedPortfolio,
      reputationByPayer: resolvedReputationByPayer,
      simulations: options.simulations,
    });
  }, [address, invoicePositions, options.simulations, resolvedPortfolio, resolvedReputationByPayer]);

  const error =
    portfolioQuery.error ??
    invoiceListQuery.error ??
    reputationQueries.find((query) => query.error)?.error ??
    null;

  const isLoading =
    Boolean(portfolioAddress && portfolioQuery.isLoading) ||
    Boolean(invoiceAddress && invoiceListQuery.isLoading) ||
    shouldFetchReputation && reputationQueries.some((query) => query.isLoading);

  return {
    data,
    isLoading,
    error: error instanceof Error ? error : null,
  };
}

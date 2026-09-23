import { useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Invoice } from '@iln/sdk';
import { ILNContext } from '../context/ILNContext';

export interface AuctionRatePoint {
  timestamp: number;
  discountBps: number;
}

export interface AuctionRateState {
  invoice: Invoice | undefined;
  currentDiscountBps: number;
  startDiscountBps: number;
  maxDiscountBps: number;
  auctionStepBps: number;
  stepIntervalSeconds: number;
  submittedAt: number;
  nextIncrementAt: number | null;
  secondsUntilNextIncrement: number;
  progressToNextStep: number;
  rateHistory: AuctionRatePoint[];
  hasAuction: boolean;
  isExpired: boolean;
  isFunded: boolean;
}

export interface UseAuctionRateOptions {
  initialInvoice?: Invoice;
  pollIntervalMs?: number;
  now?: () => number;
}

export interface UseAuctionRateResult extends AuctionRateState {
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

type AuctionInvoiceRecord = Record<string, unknown>;

const DEFAULT_POLL_INTERVAL_MS = 10_000;

function readNumber(
  record: AuctionInvoiceRecord | undefined,
  ...keys: string[]
): number | undefined {
  if (!record) return undefined;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return undefined;
}

function readStatus(record: AuctionInvoiceRecord | undefined): string {
  const status = record?.status;
  return typeof status === 'string' ? status.toLowerCase() : '';
}

function buildHistory({
  startDiscountBps,
  maxDiscountBps,
  auctionStepBps,
  stepIntervalSeconds,
  submittedAt,
  nowSeconds,
}: {
  startDiscountBps: number;
  maxDiscountBps: number;
  auctionStepBps: number;
  stepIntervalSeconds: number;
  submittedAt: number;
  nowSeconds: number;
}): AuctionRatePoint[] {
  if (stepIntervalSeconds <= 0 || auctionStepBps <= 0 || submittedAt <= 0) {
    return [{ timestamp: nowSeconds, discountBps: startDiscountBps }];
  }

  const elapsedSteps = Math.max(0, Math.floor((nowSeconds - submittedAt) / stepIntervalSeconds));
  const maxSteps = Math.max(0, Math.ceil((maxDiscountBps - startDiscountBps) / auctionStepBps));
  const pointCount = Math.min(Math.max(elapsedSteps, 0), maxSteps, 24);
  const firstStep = Math.max(0, elapsedSteps - pointCount);
  const points: AuctionRatePoint[] = [];

  for (let step = firstStep; step <= elapsedSteps; step += 1) {
    points.push({
      timestamp: submittedAt + step * stepIntervalSeconds,
      discountBps: Math.min(startDiscountBps + step * auctionStepBps, maxDiscountBps),
    });
  }

  if (points.length === 0) {
    points.push({ timestamp: submittedAt, discountBps: startDiscountBps });
  }

  return points;
}

export function deriveAuctionRateState(
  invoice: Invoice | undefined,
  nowSeconds: number
): AuctionRateState {
  const record = invoice as AuctionInvoiceRecord | undefined;
  const startDiscountBps =
    readNumber(record, 'startDiscountBps', 'start_discount_bps') ??
    readNumber(record, 'discountRate', 'discount_bps') ??
    0;
  const maxDiscountBps =
    readNumber(record, 'maxDiscountBps', 'max_discount_bps') ?? startDiscountBps;
  const auctionStepBps = readNumber(record, 'auctionStepBps', 'auction_step_bps') ?? 0;
  const stepIntervalSeconds =
    readNumber(record, 'stepIntervalSeconds', 'step_interval_seconds') ?? 0;
  const submittedAt =
    readNumber(record, 'submittedAt', 'submitted_at', 'createdAt', 'created_at') ?? 0;
  const dueDate = readNumber(record, 'dueDate', 'due_date');
  const contractDiscount =
    readNumber(record, 'currentDiscountBps', 'current_discount_bps') ??
    readNumber(record, 'currentDiscount', 'current_discount');

  const hasAuction =
    maxDiscountBps > startDiscountBps &&
    auctionStepBps > 0 &&
    stepIntervalSeconds > 0 &&
    submittedAt > 0;

  const elapsedSteps = hasAuction
    ? Math.max(0, Math.floor((nowSeconds - submittedAt) / stepIntervalSeconds))
    : 0;
  const computedDiscount = hasAuction
    ? Math.min(startDiscountBps + elapsedSteps * auctionStepBps, maxDiscountBps)
    : startDiscountBps;
  const currentDiscountBps = Math.min(contractDiscount ?? computedDiscount, maxDiscountBps);
  const currentStepStartedAt = hasAuction ? submittedAt + elapsedSteps * stepIntervalSeconds : null;
  const nextIncrementAt =
    hasAuction && currentDiscountBps < maxDiscountBps && currentStepStartedAt !== null
      ? currentStepStartedAt + stepIntervalSeconds
      : null;
  const secondsUntilNextIncrement =
    nextIncrementAt === null ? 0 : Math.max(0, nextIncrementAt - nowSeconds);
  const progressToNextStep =
    hasAuction && currentStepStartedAt !== null && nextIncrementAt !== null
      ? Math.min(1, Math.max(0, (nowSeconds - currentStepStartedAt) / stepIntervalSeconds))
      : 1;
  const status = readStatus(record);

  return {
    invoice,
    currentDiscountBps,
    startDiscountBps,
    maxDiscountBps,
    auctionStepBps,
    stepIntervalSeconds,
    submittedAt,
    nextIncrementAt,
    secondsUntilNextIncrement,
    progressToNextStep,
    rateHistory: buildHistory({
      startDiscountBps,
      maxDiscountBps,
      auctionStepBps,
      stepIntervalSeconds,
      submittedAt,
      nowSeconds,
    }),
    hasAuction,
    isExpired: typeof dueDate === 'number' && dueDate > 0 ? nowSeconds >= dueDate : false,
    isFunded: ['funded', 'paid', 'defaulted'].includes(status),
  };
}

export function useAuctionRate(
  invoiceId: number,
  options: UseAuctionRateOptions = {}
): UseAuctionRateResult {
  const client = useContext(ILNContext);
  const {
    initialInvoice,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    now = () => Math.floor(Date.now() / 1000),
  } = options;
  const [nowSeconds, setNowSeconds] = useState(now);

  useEffect(() => {
    const timer = setInterval(() => setNowSeconds(now()), 1_000);
    return () => clearInterval(timer);
  }, [now]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['invoices', 'auction-rate', invoiceId],
    queryFn: async () => {
      if (!client) {
        throw new Error('useAuctionRate requires an ILNProvider for live contract polling.');
      }

      const auctionClient = client as unknown as {
        getAuctionRate?: (id: number) => Promise<Invoice>;
        getCurrentDiscount?: (
          id: number
        ) => Promise<number | { currentDiscountBps?: number; invoice?: Invoice }>;
        getInvoice: (id: number) => Promise<Invoice>;
      };

      if (typeof auctionClient.getAuctionRate === 'function') {
        return auctionClient.getAuctionRate(invoiceId);
      }

      if (typeof auctionClient.getCurrentDiscount === 'function') {
        const current = await auctionClient.getCurrentDiscount(invoiceId);
        if (typeof current === 'number') {
          return {
            ...(initialInvoice as unknown as AuctionInvoiceRecord | undefined),
            currentDiscountBps: current,
          } as unknown as Invoice;
        }

        if (current.invoice) {
          return {
            ...(current.invoice as unknown as AuctionInvoiceRecord),
            currentDiscountBps: current.currentDiscountBps,
          } as unknown as Invoice;
        }
      }

      return auctionClient.getInvoice(invoiceId);
    },
    enabled: invoiceId > 0 && Boolean(client),
    placeholderData: initialInvoice,
    refetchInterval: pollIntervalMs,
    staleTime: Math.min(pollIntervalMs, 30_000),
  });

  const state = useMemo(() => deriveAuctionRateState(data, nowSeconds), [data, nowSeconds]);

  return {
    ...state,
    isLoading,
    error: error instanceof Error ? error : null,
    refetch,
  };
}

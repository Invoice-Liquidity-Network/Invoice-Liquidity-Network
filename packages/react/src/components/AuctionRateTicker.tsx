import React, { useContext, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Invoice } from '@invoice-liquidity/sdk';
import { useAuctionRate } from '../hooks/useAuctionRate';
import { ILNContext } from '../context/ILNContext';

export interface AuctionRateTickerProps {
  invoiceId: number;
  invoice?: Invoice;
  funder?: string;
  pollIntervalMs?: number;
  showChart?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onFund?: (params: { invoiceId: number; currentDiscountBps: number; funder?: string }) => Promise<void> | void;
  onFunded?: () => void;
  onError?: (error: Error) => void;
}

const BACKDROP = '#FCF7F0';
const PANEL = '#FFFDF9';
const PANEL_ALT = '#F6EFE7';
const BORDER = '#E7DCCF';
const TEXT = '#1F2937';
const MUTED = '#5B6370';
const ACCENT = '#B45309';
const POSITIVE = '#15803D';
const DANGER = '#B91C1C';

function formatBps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'now';

  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function chartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div style={{
      background: '#111827',
      color: '#F9FAFB',
      padding: '10px 12px',
      borderRadius: 12,
      boxShadow: '0 14px 30px rgba(0,0,0,0.18)',
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 700 }}>{formatBps(Number(payload[0]?.value ?? 0))}</div>
      <div>{new Date(Number(label) * 1000).toLocaleTimeString()}</div>
    </div>
  );
}

export function AuctionRateTicker({
  invoiceId,
  invoice,
  funder,
  pollIntervalMs,
  showChart = true,
  className,
  style,
  onFund,
  onFunded,
  onError,
}: AuctionRateTickerProps): JSX.Element {
  const client = useContext(ILNContext);
  const queryClient = useQueryClient();
  const auction = useAuctionRate(invoiceId, {
    initialInvoice: invoice,
    pollIntervalMs,
  });
  const fundMutation = useMutation({
    mutationFn: async () => {
      if (onFund) {
        await onFund({
          invoiceId,
          currentDiscountBps: auction.currentDiscountBps,
          funder,
        });
        return;
      }

      if (!client) {
        throw new Error('Connect an ILN client before funding this auction.');
      }

      if (!funder) {
        throw new Error('Connect an LP wallet before funding this auction.');
      }

      await (client as unknown as {
        fundInvoice(params: { invoiceId: number; funder: string; expectedDiscountBps?: number }): Promise<unknown>;
      }).fundInvoice({
        invoiceId,
        funder,
        expectedDiscountBps: auction.currentDiscountBps,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onFunded?.();
      await auction.refetch();
    },
  });

  const chartData = useMemo(
    () => auction.rateHistory.map((point) => ({
      timestamp: point.timestamp,
      rate: point.discountBps,
    })),
    [auction.rateHistory],
  );

  const disabledReason = auction.isExpired
    ? 'Auction expired'
    : auction.isFunded
      ? 'Already funded'
      : !client && !onFund
        ? 'Connect ILN client'
        : !funder && !onFund
          ? 'Connect LP wallet'
          : null;

  const handleFund = async () => {
    try {
      await fundMutation.mutateAsync();
    } catch (caught) {
      onError?.(caught instanceof Error ? caught : new Error(String(caught)));
    }
  };

  const actionError = auction.error ?? (fundMutation.error instanceof Error ? fundMutation.error : null);

  return (
    <section
      className={className}
      aria-labelledby={`auction-rate-${invoiceId}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 24,
        background: BACKDROP,
        color: TEXT,
        padding: 20,
        boxSizing: 'border-box',
        boxShadow: '0 18px 40px rgba(31,41,55,0.07)',
        fontFamily: '"Manrope", "Segoe UI", sans-serif',
        ...style,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at top left, rgba(180,83,9,0.16), transparent 32%), linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.18))',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div style={{
              color: ACCENT,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}>
              Dutch Auction
            </div>
            <h3 id={`auction-rate-${invoiceId}`} style={{
              margin: 0,
              fontFamily: '"Newsreader", Georgia, serif',
              fontSize: 'clamp(1.6rem, 4vw, 2.4rem)',
              lineHeight: 1,
            }}>
              {auction.isLoading ? 'Loading rate…' : formatBps(auction.currentDiscountBps)}
            </h3>
          </div>

          <button
            type="button"
            onClick={handleFund}
            disabled={Boolean(disabledReason) || fundMutation.isPending || auction.isLoading}
            style={{
              alignSelf: 'flex-start',
              border: 'none',
              borderRadius: 999,
              padding: '12px 18px',
              background: disabledReason ? PANEL_ALT : TEXT,
              color: disabledReason ? MUTED : '#FFFDF9',
              cursor: disabledReason ? 'not-allowed' : 'pointer',
              fontWeight: 800,
              boxShadow: disabledReason ? 'none' : '0 10px 22px rgba(31,41,55,0.18)',
            }}
          >
            {fundMutation.isPending ? 'Funding…' : disabledReason ?? 'Fund at Current Rate'}
          </button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: showChart ? 16 : 0,
        }}>
          <div style={metricStyle}>
            <span style={metricLabelStyle}>Starts at</span>
            <strong>{formatBps(auction.startDiscountBps)}</strong>
          </div>
          <div style={metricStyle}>
            <span style={metricLabelStyle}>Max rate</span>
            <strong>{formatBps(auction.maxDiscountBps)}</strong>
          </div>
          <div style={metricStyle}>
            <span style={metricLabelStyle}>Next increment</span>
            <strong>{auction.nextIncrementAt ? formatCountdown(auction.secondsUntilNextIncrement) : 'Ceiling reached'}</strong>
          </div>
        </div>

        {auction.nextIncrementAt && (
          <div
            aria-label={`Next rate increment progress: ${Math.round(auction.progressToNextStep * 100)} percent`}
            style={{
              height: 8,
              background: PANEL_ALT,
              borderRadius: 999,
              overflow: 'hidden',
              marginBottom: showChart ? 16 : 0,
            }}
          >
            <div style={{
              width: `${Math.round(auction.progressToNextStep * 100)}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${ACCENT}, ${POSITIVE})`,
              borderRadius: 999,
            }} />
          </div>
        )}

        {showChart && chartData.length > 0 && (
          <div style={{ height: 180, background: PANEL, borderRadius: 18, padding: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id={`auctionRateFill-${invoiceId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={ACCENT} stopOpacity={0.32} />
                    <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke={BORDER} />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(value) => new Date(Number(value) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  stroke={MUTED}
                />
                <YAxis tickFormatter={(value) => formatBps(Number(value))} stroke={MUTED} width={56} />
                <Tooltip content={chartTooltip as never} />
                <Area
                  type="stepAfter"
                  dataKey="rate"
                  stroke={ACCENT}
                  strokeWidth={3}
                  fill={`url(#auctionRateFill-${invoiceId})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {actionError && (
          <p role="alert" style={{ margin: '12px 0 0 0', color: DANGER, fontSize: 13, fontWeight: 600 }}>
            {actionError.message}
          </p>
        )}
      </div>
    </section>
  );
}

const metricStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  background: PANEL,
  borderRadius: 16,
  padding: '12px 14px',
};

const metricLabelStyle: React.CSSProperties = {
  color: MUTED,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

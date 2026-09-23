import React from 'react';
import { usePoolBalance, useClaimsList } from '../hooks/useInsurance';
import { StatsCard } from './StatsCard';

export interface InsuranceAnalyticsProps {
  className?: string;
  style?: React.CSSProperties;
}

const PANEL_BG = '#FCF7F0';
const PANEL = '#FFFDF9';
const PANEL_ALT = '#F6EFE7';
const BORDER = '#E7DCCF';
const TEXT = '#1F2937';
const MUTED = '#5B6370';
const POSITIVE = '#15803D';
const WARNING = '#B45309';
const DANGER = '#B91C1C';
const ACCENT = '#8B5E34';

function formatCurrency(value: bigint | undefined): string {
  if (value === null || value === undefined) return '$0.00';
  return `$${(Number(value) / 10_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value: number): string {
  if (value === 0) return '0%';
  return `${(value * 100).toFixed(1)}%`;
}

export function InsuranceAnalytics({ className, style }: InsuranceAnalyticsProps) {
  const { data: poolBalance, error: poolError } = usePoolBalance();
  const { data: pendingClaims } = useClaimsList('Pending');
  const { data: approvedClaims } = useClaimsList('Approved');
  const { data: rejectedClaims } = useClaimsList('Rejected');

  const totalPremiums = poolBalance?.totalPremiums ?? 0n;
  const totalPayouts = poolBalance?.totalPayouts ?? 0n;
  const reserve = poolBalance?.reserveBalance ?? 0n;
  const payoutRatio = totalPremiums > 0n ? Number(totalPayouts) / Number(totalPremiums) : 0;
  const reserveRatio = totalPremiums > 0n ? Number(reserve) / Number(totalPremiums) : 0;
  const approvalRate =
    (approvedClaims?.length ?? 0) + (rejectedClaims?.length ?? 0) > 0
      ? ((approvedClaims?.length ?? 0) /
          ((approvedClaims?.length ?? 0) + (rejectedClaims?.length ?? 0))) *
        100
      : 0;

  return (
    <section
      className={className}
      style={{
        borderRadius: 28,
        border: `1px solid ${BORDER}`,
        background: PANEL_BG,
        padding: 24,
        color: TEXT,
        fontFamily: '"Manrope", "Segoe UI", sans-serif',
        ...style,
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: ACCENT,
          fontWeight: 800,
          marginBottom: 8,
        }}
      >
        Analytics
      </div>
      <h2
        style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 'clamp(1.6rem, 3vw, 2.4rem)',
          lineHeight: 1.1,
          margin: '0 0 6px 0',
        }}
      >
        Insurance Pool Analytics
      </h2>
      <p style={{ margin: '0 0 20px 0', color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
        Key metrics and health indicators for the LP insurance pool.
      </p>

      {poolError && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            borderRadius: 18,
            border: `1px solid #FCA5A5`,
            background: '#FEF2F2',
            color: DANGER,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          Failed to load pool data: {poolError.message}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          marginBottom: 20,
        }}
      >
        <StatsCard
          title="Pool Reserve"
          value={formatCurrency(reserve)}
          accentColor={POSITIVE}
          style={{ background: PANEL }}
        />
        <StatsCard
          title="Total Premiums"
          value={formatCurrency(totalPremiums)}
          accentColor={ACCENT}
          style={{ background: PANEL }}
        />
        <StatsCard
          title="Total Payouts"
          value={formatCurrency(totalPayouts)}
          accentColor={DANGER}
          style={{ background: PANEL }}
        />
        <StatsCard
          title="Payout Ratio"
          value={formatPercent(payoutRatio)}
          accentColor={WARNING}
          style={{ background: PANEL }}
        />
        <StatsCard
          title="Reserve Ratio"
          value={formatPercent(reserveRatio)}
          accentColor={reserveRatio > 0.3 ? POSITIVE : WARNING}
          style={{ background: PANEL }}
        />
        <StatsCard
          title="Approval Rate"
          value={`${approvalRate.toFixed(0)}%`}
          accentColor={approvalRate > 50 ? POSITIVE : WARNING}
          style={{ background: PANEL }}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        }}
      >
        <div
          style={{
            padding: 18,
            borderRadius: 24,
            border: `1px solid ${BORDER}`,
            background: PANEL,
          }}
        >
          <h3
            style={{
              margin: '0 0 12px 0',
              fontFamily: '"Newsreader", Georgia, serif',
              fontSize: 16,
            }}
          >
            Claims Breakdown
          </h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <MetricRow label="Pending" value={pendingClaims?.length ?? 0} color={WARNING} />
            <MetricRow label="Approved" value={approvedClaims?.length ?? 0} color={POSITIVE} />
            <MetricRow label="Rejected" value={rejectedClaims?.length ?? 0} color={DANGER} />
          </div>
        </div>

        <div
          style={{
            padding: 18,
            borderRadius: 24,
            border: `1px solid ${BORDER}`,
            background: PANEL,
          }}
        >
          <h3
            style={{
              margin: '0 0 12px 0',
              fontFamily: '"Newsreader", Georgia, serif',
              fontSize: 16,
            }}
          >
            Pool Health
          </h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>Reserve Coverage</div>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: PANEL_ALT,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(reserveRatio * 100, 100)}%`,
                    borderRadius: 4,
                    background: reserveRatio > 0.3 ? POSITIVE : WARNING,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
                {formatPercent(reserveRatio)} of premiums held in reserve
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>Enrolled LPs</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{poolBalance?.enrolledLps ?? 0}</div>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: 18,
            borderRadius: 24,
            border: `1px solid ${BORDER}`,
            background: PANEL,
          }}
        >
          <h3
            style={{
              margin: '0 0 12px 0',
              fontFamily: '"Newsreader", Georgia, serif',
              fontSize: 16,
            }}
          >
            Active Risk
          </h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <MetricRow
              label="Active Claims"
              value={poolBalance?.activeClaims ?? 0}
              color={WARNING}
            />
            <MetricRow label="Pending Review" value={pendingClaims?.length ?? 0} color={WARNING} />
            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
              Potential exposure:{' '}
              {formatCurrency(
                BigInt(poolBalance?.pendingClaims ?? 0) *
                  (reserve > 0n
                    ? reserve / BigInt(Math.max(poolBalance?.activeClaims ?? 1, 1))
                    : 0n)
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

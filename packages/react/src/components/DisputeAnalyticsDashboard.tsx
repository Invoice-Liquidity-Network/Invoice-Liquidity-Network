import React from 'react';
import { useDisputeAnalytics } from '../hooks/useDispute';
import { StatsCard } from './StatsCard';
import { ResponsiveGrid } from './ResponsiveGrid';

export interface DisputeAnalyticsDashboardProps {
  className?: string;
  style?: React.CSSProperties;
}

const PANEL_BG = '#FCF7F0';
const PANEL = '#FFFDF9';
const PANEL_ALT = '#F6EFE7';
const BORDER = '#E7DCCF';
const TEXT = '#1F2937';
const MUTED = '#5B6370';
const ACCENT = '#8B5E34';
const POSITIVE = '#15803D';
const DANGER = '#B91C1C';

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0h';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function DisputeAnalyticsDashboard({
  className,
  style,
}: DisputeAnalyticsDashboardProps) {
  const { data: analytics, isLoading, error } = useDisputeAnalytics();

  if (isLoading) {
    return (
      <div
        className={className}
        style={{
          padding: 32,
          textAlign: 'center',
          background: PANEL_BG,
          borderRadius: 28,
          border: `1px solid ${BORDER}`,
          color: MUTED,
          ...style,
        }}
      >
        Loading dispute resolution analytics...
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div
        className={className}
        style={{
          padding: 24,
          background: '#FEF2F2',
          border: `1px solid #FECACA`,
          borderRadius: 24,
          color: DANGER,
          ...style,
        }}
      >
        Failed to load dispute analytics.
      </div>
    );
  }

  const freelancerWinPct = Math.round((analytics.winRateByParty?.freelancer ?? 0) * 100);
  const payerWinPct = Math.round((analytics.winRateByParty?.payer ?? 0) * 100);
  const reasons = analytics.commonDisputeReasons || { quality: 0, timing: 0, amount: 0, other: 0 };
  const totalCategorized = reasons.quality + reasons.timing + reasons.amount + reasons.other;

  return (
    <section
      className={className}
      aria-label="Dispute Resolution Analytics"
      style={{
        borderRadius: 28,
        border: `1px solid ${BORDER}`,
        background: PANEL_BG,
        padding: 24,
        color: TEXT,
        fontFamily: '"Manrope", "Segoe UI", sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        ...style,
      }}
    >
      <div>
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
          Network Metrics
        </div>
        <h2
          style={{
            fontFamily: '"Newsreader", Georgia, serif',
            fontSize: 'clamp(1.5rem, 2.5vw, 2.2rem)',
            lineHeight: 1.1,
            margin: '0 0 6px 0',
          }}
        >
          Dispute Resolution Analytics
        </h2>
        <p style={{ margin: 0, color: MUTED, fontSize: 13 }}>
          Platform dispute rates, resolution timelines, and arbitration win rate metrics.
        </p>
      </div>

      <ResponsiveGrid columns={{ sm: 1, md: 3, lg: 3 }} gap={16}>
        <StatsCard
          title="Total Disputes"
          value={analytics.totalDisputes.toLocaleString()}
          description="All-time filed disputes"
        />
        <StatsCard
          title="Avg Resolution Time"
          value={formatDuration(analytics.averageResolutionTimeSeconds)}
          description="From filing to arbitration settlement"
        />
        <StatsCard
          title="Arbitration Win Rate"
          value={`${freelancerWinPct}% / ${payerWinPct}%`}
          description="Freelancer vs Payer favor rate"
        />
      </ResponsiveGrid>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Reasons breakdown */}
        <div
          style={{
            background: PANEL,
            border: `1px solid ${BORDER}`,
            borderRadius: 20,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
            Common Dispute Reasons
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Quality of Work', count: reasons.quality, color: ACCENT },
              { label: 'Late Delivery / Timing', count: reasons.timing, color: '#D97706' },
              { label: 'Incorrect Amount / Scope', count: reasons.amount, color: '#2563EB' },
              { label: 'Other Breaches', count: reasons.other, color: MUTED },
            ].map(({ label, count, color }) => {
              const pct = totalCategorized > 0 ? Math.round((count / totalCategorized) * 100) : 0;
              return (
                <div key={label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span>{label}</span>
                    <span style={{ fontWeight: 700 }}>{count} ({pct}%)</span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: PANEL_ALT,
                      borderRadius: 9999,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: color,
                        borderRadius: 9999,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Payer dispute rate overview */}
        <div
          style={{
            background: PANEL,
            border: `1px solid ${BORDER}`,
            borderRadius: 20,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
            Dispute Rates by Payer
          </h3>
          {Object.keys(analytics.disputeRateByPayer || {}).length === 0 ? (
            <div style={{ color: MUTED, fontSize: 12, textAlign: 'center', padding: 20 }}>
              No payer dispute rate data available.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
              {Object.entries(analytics.disputeRateByPayer).map(([payer, rate]) => (
                <div
                  key={payer}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: PANEL_ALT,
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontFamily: 'monospace' }}>
                    {payer.slice(0, 8)}...{payer.slice(-6)}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: rate > 0.3 ? DANGER : rate > 0.1 ? '#D97706' : POSITIVE,
                    }}
                  >
                    {(rate * 100).toFixed(1)}% dispute rate
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

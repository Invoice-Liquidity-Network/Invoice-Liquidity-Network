import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Invoice, LPPortfolio } from '@invoice-liquidity/sdk';
import { AddressDisplay } from './AddressDisplay';
import { ResponsiveGrid } from './ResponsiveGrid';
import { StatsCard } from './StatsCard';
import { useLPRiskMetrics } from '../hooks/useLPRiskMetrics';
import type {
  LPRiskMetrics,
  LPRiskPayerExposure,
  LPRiskTokenDiversification,
  LPRiskMaturityBucket,
} from '../hooks/lpRiskMetrics';

const PALETTE = ['#8B5E34', '#C26E2E', '#D97706', '#B45309', '#6B7280', '#9A3412'];
const BACKDROP = '#FCF7F0';
const PANEL = '#FFFDF9';
const PANEL_ALT = '#F6EFE7';
const BORDER = '#E7DCCF';
const TEXT = '#1F2937';
const MUTED = '#5B6370';
const POSITIVE = '#15803D';
const WARNING = '#B45309';
const DANGER = '#B91C1C';

function formatCurrency(value: bigint): string {
  return (Number(value) / 10_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRatio(value: number): string {
  return value.toFixed(2);
}

function formatPayerLabel(address: string): string {
  if (address.length <= 12) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function pieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { payer?: string; token?: string; value?: number; amount?: bigint; share?: number } }> }) {
  if (!active || !payload?.length) {
    return null;
  }

  const item = payload[0]?.payload;
  if (!item) {
    return null;
  }

  return (
    <div style={{
      background: '#111827',
      color: '#F9FAFB',
      padding: '10px 12px',
      borderRadius: '10px',
      boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
      fontSize: '12px',
      maxWidth: '220px',
    }}>
      <div style={{ fontWeight: 700, marginBottom: '4px' }}>
        {item.payer ? formatPayerLabel(item.payer) : item.token ?? 'Exposure'}
      </div>
      <div>{formatPercent(item.share ?? 0)}</div>
      {'amount' in item && typeof item.amount === 'bigint' && (
        <div>{formatCurrency(item.amount)} units</div>
      )}
    </div>
  );
}

function barTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: { amount?: bigint; share?: number; positionCount?: number } }>; label?: string | number }) {
  if (!active || !payload?.length) {
    return null;
  }

  const item = payload[0]?.payload;
  if (!item) {
    return null;
  }

  return (
    <div style={{
      background: '#111827',
      color: '#F9FAFB',
      padding: '10px 12px',
      borderRadius: '10px',
      boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
      fontSize: '12px',
      maxWidth: '220px',
    }}>
      <div style={{ fontWeight: 700, marginBottom: '4px' }}>{String(label ?? '')}</div>
      <div>{formatPercent(item.share ?? 0)}</div>
      {'amount' in item && typeof item.amount === 'bigint' && (
        <div>{formatCurrency(item.amount)} units</div>
      )}
      {typeof item.positionCount === 'number' && <div>{item.positionCount} positions</div>}
    </div>
  );
}

function MetricPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'positive';
}): JSX.Element {
  const toneMap = {
    neutral: { bg: PANEL_ALT, text: TEXT },
    warning: { bg: '#FEF3C7', text: WARNING },
    danger: { bg: '#FEE2E2', text: DANGER },
    positive: { bg: '#DCFCE7', text: POSITIVE },
  } as const;

  const colors = toneMap[tone];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      padding: '12px 14px',
      borderRadius: 16,
      background: colors.bg,
      border: `1px solid ${BORDER}`,
    }}>
      <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 20, color: colors.text, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

export function PayerConcentrationChart({
  data,
}: {
  data: LPRiskPayerExposure[];
}): JSX.Element {
  const pieData = data.map((entry) => ({
    name: formatPayerLabel(entry.payer),
    payer: entry.payer,
    value: Number(entry.amount),
    amount: entry.amount,
    share: entry.share,
  }));

  return (
    <section aria-labelledby="payer-concentration" style={cardStyle}>
      <h3 id="payer-concentration" style={cardTitleStyle}>Concentration Risk</h3>
      <p style={cardDescriptionStyle}>Exposure by payer address. The largest slice is your herd-risk anchor.</p>
      <div style={chartWrapStyle}>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Tooltip content={pieTooltip as never} />
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={72}
              outerRadius={108}
              paddingAngle={2}
            >
              {pieData.map((entry, index) => (
                <Cell key={entry.payer} fill={PALETTE[index % PALETTE.length]} />
              ))}
            </Pie>
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ol style={summaryListStyle}>
        {data.slice(0, 4).map((entry) => (
          <li key={entry.payer} style={summaryItemStyle}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 700, color: TEXT }}><AddressDisplay address={entry.payer} copyable={false} /></span>
              <span style={{ color: MUTED, fontSize: 12 }}>{formatCurrency(entry.amount)} units</span>
            </div>
            <strong style={{ color: TEXT }}>{formatPercent(entry.share)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TokenDiversificationChart({
  data,
}: {
  data: LPRiskTokenDiversification[];
}): JSX.Element {
  const barData = data.map((entry) => ({
    token: entry.token,
    value: Number(entry.amount),
    amount: entry.amount,
    share: entry.share,
    positionCount: entry.positionCount,
  }));

  return (
    <section aria-labelledby="token-diversification" style={cardStyle}>
      <h3 id="token-diversification" style={cardTitleStyle}>Token Diversification</h3>
      <p style={cardDescriptionStyle}>Position breakdown across settlement tokens.</p>
      <div style={chartWrapStyle}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20, top: 12, bottom: 12 }}>
            <CartesianGrid strokeDasharray="4 4" stroke={BORDER} />
            <XAxis type="number" tickFormatter={(value) => `${Number(value) / 10_000_000}u`} stroke={MUTED} />
            <YAxis type="category" dataKey="token" width={72} stroke={MUTED} />
            <Tooltip content={barTooltip as never} />
            <Bar dataKey="value" radius={[0, 12, 12, 0]}>
              {barData.map((entry, index) => (
                <Cell key={entry.token} fill={PALETTE[(index + 1) % PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ol style={summaryListStyle}>
        {data.map((entry) => (
          <li key={entry.token} style={summaryItemStyle}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 700, color: TEXT }}>{entry.token}</span>
              <span style={{ color: MUTED, fontSize: 12 }}>{entry.positionCount} positions</span>
            </div>
            <strong style={{ color: TEXT }}>{formatPercent(entry.share)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function MaturityProfileChart({
  data,
}: {
  data: LPRiskMaturityBucket[];
}): JSX.Element {
  const barData = data.map((entry) => ({
    bucket: entry.label,
    value: Number(entry.amount),
    amount: entry.amount,
    share: entry.share,
    positionCount: entry.positionCount,
  }));

  return (
    <section aria-labelledby="maturity-profile" style={cardStyle}>
      <h3 id="maturity-profile" style={cardTitleStyle}>Maturity Profile</h3>
      <p style={cardDescriptionStyle}>Positions grouped by days until due date.</p>
      <div style={chartWrapStyle}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={barData} margin={{ left: 4, right: 20, top: 12, bottom: 12 }}>
            <CartesianGrid strokeDasharray="4 4" stroke={BORDER} />
            <XAxis dataKey="bucket" stroke={MUTED} />
            <YAxis tickFormatter={(value) => `${Number(value) / 10_000_000}u`} stroke={MUTED} />
            <Tooltip content={barTooltip as never} />
            <Bar dataKey="value" radius={[12, 12, 0, 0]}>
              {barData.map((entry, index) => (
                <Cell key={entry.bucket} fill={PALETTE[(index + 2) % PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ol style={summaryListStyle}>
        {data.map((entry) => (
          <li key={entry.label} style={summaryItemStyle}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 700, color: TEXT }}>{entry.label}</span>
              <span style={{ color: MUTED, fontSize: 12 }}>{entry.positionCount} positions</span>
            </div>
            <strong style={{ color: TEXT }}>{formatPercent(entry.share)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export interface LPRiskDashboardProps {
  address: string;
  portfolio?: LPPortfolio;
  invoices?: Invoice[];
  reputationByPayer?: Record<string, number>;
  simulations?: number;
  isLoading?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function LPRiskDashboard({
  address,
  portfolio,
  invoices,
  reputationByPayer,
  simulations,
  isLoading: externalLoading = false,
  className,
  style,
}: LPRiskDashboardProps): JSX.Element {
  const { data, isLoading, error } = useLPRiskMetrics(address, {
    portfolio,
    invoices,
    reputationByPayer,
    simulations,
  });

  const loading = externalLoading || isLoading;

  const topPayer = data?.payerExposure[0];
  const topToken = data?.tokenDiversification[0];
  const nearTerm = data?.maturityProfile[0];

  const headerStats = useMemo(() => {
    if (!data) {
      return null;
    }

    return [
      {
        label: 'Diversification',
        value: formatRatio(1 - data.herdShare),
        tone: data.herdRisk ? 'warning' : 'positive',
      },
      {
        label: 'HHI',
        value: Math.round(data.herfindahlHirschmanIndex).toLocaleString(),
        tone: data.herdRisk ? 'danger' : 'neutral',
      },
      {
        label: 'VaR 95',
        value: formatCurrency(data.valueAtRisk95),
        tone: data.valueAtRisk95 > 0n ? 'warning' : 'neutral',
      },
      {
        label: 'Sharpe',
        value: formatRatio(data.sharpeRatio),
        tone: data.sharpeRatio > 1 ? 'positive' : 'neutral',
      },
    ] as const;
  }, [data]);

  return (
    <section
      className={className}
      style={{
        ...dashboardShellStyle,
        ...style,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,400;6..72,600;6..72,700&display=swap');
      ` }} />
      <div style={dashboardBackgroundStyle} aria-hidden="true" />
      <header style={{ position: 'relative', zIndex: 1, marginBottom: 24 }}>
        <div style={eyebrowStyle}>Liquidity Provider Risk Intelligence</div>
        <h2 style={dashboardTitleStyle}>Comprehensive portfolio risk analytics for LPs</h2>
        <p style={dashboardSubtitleStyle}>
          Monitor payer concentration, token mix, maturity pressure, default probability, and yield-adjusted exposure for {address}.
        </p>
      </header>

      {loading ? (
        <ResponsiveGrid cols={{ xs: 1, sm: 2, lg: 4 }} gap={16} style={{ position: 'relative', zIndex: 1 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} style={{ ...cardStyle, minHeight: 112, background: PANEL, opacity: 0.8 }} />
          ))}
        </ResponsiveGrid>
      ) : error ? (
        <div role="alert" style={{
          position: 'relative',
          zIndex: 1,
          padding: '16px 18px',
          borderRadius: 18,
          border: `1px solid #FCA5A5`,
          background: '#FEF2F2',
          color: DANGER,
          fontWeight: 600,
        }}>
          Unable to load LP risk metrics: {error.message}
        </div>
      ) : data ? (
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
            <MetricPill
              label="Herd Risk"
              value={data.herdRisk ? 'Alert' : 'Clear'}
              tone={data.herdRisk ? 'danger' : 'positive'}
            />
            <MetricPill label="Top payer share" value={formatPercent(data.herdShare)} tone={data.herdRisk ? 'warning' : 'neutral'} />
            <MetricPill label="Default probability" value={formatPercent(data.defaultProbabilityEstimate)} tone="warning" />
            <MetricPill label="Yield / Risk" value={formatRatio(data.yieldAdjustedRiskScore)} tone="positive" />
          </div>

          {data.herdRisk && (
            <div style={{
              marginBottom: 18,
              padding: '14px 16px',
              borderRadius: 18,
              border: `1px solid #FDBA74`,
              background: '#FFF7ED',
              color: '#9A3412',
              fontWeight: 600,
            }}>
              Herd risk detected: more than 30% of this LP portfolio is concentrated in a single payer.
            </div>
          )}

          <ResponsiveGrid cols={{ xs: 1, lg: 2 }} gap={18} style={{ marginBottom: 18 }}>
            {headerStats?.map((stat) => (
              <StatsCard
                key={stat.label}
                title={stat.label}
                value={stat.value}
                accentColor={
                  stat.tone === 'danger' ? DANGER :
                  stat.tone === 'warning' ? WARNING :
                  stat.tone === 'positive' ? POSITIVE :
                  '#8B5E34'
                }
                style={{ background: PANEL }}
              />
            ))}
          </ResponsiveGrid>

          <ResponsiveGrid cols={{ xs: 1, xl: 3 }} gap={18}>
            <PayerConcentrationChart data={data.payerExposure} />
            <TokenDiversificationChart data={data.tokenDiversification} />
            <MaturityProfileChart data={data.maturityProfile} />
          </ResponsiveGrid>

          <div style={{ display: 'grid', gap: 18, marginTop: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <section style={cardStyle}>
              <h3 style={cardTitleStyle}>Default Probability Estimate</h3>
              <p style={cardDescriptionStyle}>
                Blended payer reputation and historical default rate.
              </p>
              <div style={{ display: 'grid', gap: 12 }}>
                <MetricPill label="Weighted probability" value={formatPercent(data.defaultProbabilityEstimate)} tone="warning" />
                <MetricPill label="Expected loss" value={formatCurrency(data.expectedLoss)} />
                <MetricPill label="Expected yield" value={formatCurrency(data.expectedYield)} tone="positive" />
              </div>
            </section>

            <section style={cardStyle}>
              <h3 style={cardTitleStyle}>Portfolio Notes</h3>
              <ul style={{ margin: 0, paddingLeft: 18, color: TEXT, lineHeight: 1.6 }}>
                <li>
                  Largest payer exposure: {topPayer ? <AddressDisplay address={topPayer.payer} copyable={false} /> : 'n/a'}
                </li>
                <li>Largest token bucket: {topToken?.token ?? 'n/a'} ({topToken ? formatPercent(topToken.share) : '0.0%'})</li>
                <li>Nearest maturity bucket: {nearTerm?.label ?? 'n/a'} ({nearTerm ? formatPercent(nearTerm.share) : '0.0%'})</li>
              </ul>
            </section>
          </div>
        </div>
      ) : (
        <div style={{
          position: 'relative',
          zIndex: 1,
          padding: '18px',
          borderRadius: 18,
          border: `1px dashed ${BORDER}`,
          background: PANEL,
          color: MUTED,
        }}>
          No LP positions found for this address yet.
        </div>
      )}
    </section>
  );
}

const dashboardShellStyle: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  borderRadius: 28,
  border: `1px solid ${BORDER}`,
  background: BACKDROP,
  padding: 24,
  boxSizing: 'border-box',
  color: TEXT,
  fontFamily: '"Manrope", "Segoe UI", sans-serif',
};

const dashboardBackgroundStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background:
    'radial-gradient(circle at top left, rgba(194,110,46,0.14), transparent 28%), radial-gradient(circle at top right, rgba(120,53,15,0.10), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.64), rgba(255,255,255,0.24))',
  pointerEvents: 'none',
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: WARNING,
  fontWeight: 800,
  marginBottom: 8,
};

const dashboardTitleStyle: React.CSSProperties = {
  fontFamily: '"Newsreader", Georgia, serif',
  fontSize: 'clamp(2rem, 4vw, 3.3rem)',
  lineHeight: 1.05,
  margin: '0 0 10px 0',
  color: TEXT,
};

const dashboardSubtitleStyle: React.CSSProperties = {
  margin: 0,
  maxWidth: 760,
  fontSize: 16,
  lineHeight: 1.65,
  color: MUTED,
};

const cardStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 24,
  border: `1px solid ${BORDER}`,
  background: PANEL,
  boxSizing: 'border-box',
  boxShadow: '0 18px 36px rgba(31,41,55,0.06)',
};

const cardTitleStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: 18,
  fontFamily: '"Newsreader", Georgia, serif',
  color: TEXT,
};

const cardDescriptionStyle: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: 13,
  lineHeight: 1.5,
  color: MUTED,
};

const chartWrapStyle: React.CSSProperties = {
  width: '100%',
  height: 280,
  marginBottom: 14,
};

const summaryListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'grid',
  gap: 10,
};

const summaryItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 14,
  background: PANEL_ALT,
};

export type { LPRiskMetrics };

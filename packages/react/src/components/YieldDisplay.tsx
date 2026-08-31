import React, { useState, useEffect } from 'react';
import type { LPPortfolio } from '@iln/sdk';
import { useLPPortfolio } from '../hooks/useLPPortfolio';

export interface YieldDisplayProps {
  /** Static portfolio data. If omitted and address is provided, fetches automatically. */
  portfolio?: LPPortfolio;
  /** Stellar address of the LP to query */
  address?: string;
  /** External loading state override */
  isLoading?: boolean;
  /** Theme preference */
  theme?: 'light' | 'dark' | 'system';
  /** Accent color used for highlighting yields and progress bars */
  accentColor?: string;
  /** Custom CSS style overrides */
  style?: React.CSSProperties;
  /** Custom CSS class names */
  className?: string;
}

export const YieldDisplay: React.FC<YieldDisplayProps> = ({
  portfolio: staticPortfolio,
  address = '',
  isLoading: staticLoading = false,
  theme = 'system',
  accentColor = '#10b981', // Success green by default for yield
  style,
  className = '',
}) => {
  // ── Theme State ──────────────────────────────────────────────────────────
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    if (theme !== 'system') {
      setResolvedTheme(theme);
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setResolvedTheme(mq.matches ? 'dark' : 'light');
    const handler = (e: MediaQueryListEvent) => setResolvedTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const isDark = resolvedTheme === 'dark';

  // Colors
  const bg = isDark ? '#1e293b' : '#ffffff';
  const border = isDark ? '#334155' : '#e2e8f0';
  const textPrimary = isDark ? '#f1f5f9' : '#0f172a';
  const textMuted = isDark ? '#94a3b8' : '#64748b';
  const calculatorBg = isDark ? '#0f172a' : '#f8fafc';
  const inputBg = isDark ? '#1e293b' : '#ffffff';
  const skeletonBg = isDark ? '#334155' : '#e2e8f0';

  // ── Data Fetching ────────────────────────────────────────────────────────
  const isAutoFetch = !staticPortfolio && !!address && address.startsWith('G');
  const {
    data: fetchedPortfolio,
    isLoading: hookLoading,
    error,
  } = useLPPortfolio(isAutoFetch ? address : '');

  const portfolio = staticPortfolio ?? fetchedPortfolio;
  const isLoading = staticLoading || (isAutoFetch && hookLoading);

  // ── Calculator State ─────────────────────────────────────────────────────
  const [calcPrincipal, setCalcPrincipal] = useState<number>(1000);
  const [calcApy, setCalcApy] = useState<number>(8.5);

  const calculatedYield = {
    weekly: (calcPrincipal * (calcApy / 100)) / 52,
    monthly: (calcPrincipal * (calcApy / 100)) / 12,
    yearly: calcPrincipal * (calcApy / 100),
  };

  // Formatting helpers
  const formatUSDC = (amount?: number | bigint) => {
    if (amount === undefined) return '0.00';
    return (Number(amount) / 10_000_000).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes iln-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .5; }
        }
        .iln-yield-skeleton {
          background-color: ${skeletonBg};
          border-radius: 6px;
          animation: iln-pulse 1.5s infinite;
        }
        .iln-calc-slider {
          -webkit-appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: ${isDark ? '#334155' : '#e2e8f0'};
          outline: none;
        }
        .iln-calc-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${accentColor};
          cursor: pointer;
          border: 2px solid ${bg};
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
          transition: transform 0.1s ease;
        }
        .iln-calc-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
      `,
        }}
      />
      <div
        className={className}
        style={{
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: '12px',
          padding: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: textPrimary,
          boxSizing: 'border-box',
          width: '100%',
          ...style,
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 600 }}>
          Yield & Earnings Overview
        </h3>

        {/* Main Stats Row */}
        {isLoading ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '16px',
              marginBottom: '24px',
            }}
          >
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                style={{ border: `1px solid ${border}`, borderRadius: '8px', padding: '16px' }}
              >
                <div
                  className="iln-yield-skeleton"
                  style={{ width: '60px', height: '12px', marginBottom: '8px' }}
                />
                <div className="iln-yield-skeleton" style={{ width: '100px', height: '24px' }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div
            style={{
              padding: '16px',
              color: '#ef4444',
              border: '1px dashed #ef4444',
              borderRadius: '8px',
              marginBottom: '24px',
              fontSize: '13px',
            }}
          >
            Could not fetch portfolio statistics: {error.message}
          </div>
        ) : portfolio ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '16px',
              marginBottom: '24px',
            }}
          >
            {/* Accrued Yield Card */}
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: '8px',
                padding: '16px',
                borderLeft: `4px solid ${accentColor}`,
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: textMuted,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                }}
              >
                Total Yield Accrued
              </div>
              <div
                style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px', color: accentColor }}
              >
                {formatUSDC(portfolio.totalYield)} USDC
              </div>
            </div>

            {/* Average Return Card */}
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: '8px',
                padding: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: textMuted,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                }}
              >
                Average APY
              </div>
              <div
                style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px', color: textPrimary }}
              >
                {Number(portfolio.avgReturn).toFixed(2)}%
              </div>
            </div>

            {/* Total Invested */}
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: '8px',
                padding: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: textMuted,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                }}
              >
                Total Invested
              </div>
              <div
                style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px', color: textPrimary }}
              >
                {formatUSDC(portfolio.totalInvested)} USDC
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '16px',
              color: textMuted,
              background: calculatorBg,
              borderRadius: '8px',
              marginBottom: '24px',
              fontSize: '13px',
              textAlign: 'center',
            }}
          >
            No portfolio connected. Use the calculator below to simulate potential returns.
          </div>
        )}

        {/* Portfolio Stats Distribution */}
        {portfolio && !isLoading && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '16px',
              marginBottom: '28px',
              fontSize: '14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: `1px solid ${border}`,
              }}
            >
              <span style={{ color: textMuted }}>Active Funding Slots</span>
              <span style={{ fontWeight: 600 }}>{portfolio.activePositions}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: `1px solid ${border}`,
              }}
            >
              <span style={{ color: textMuted }}>Completed Positions</span>
              <span style={{ fontWeight: 600 }}>{portfolio.completedPositions}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: `1px solid ${border}`,
              }}
            >
              <span style={{ color: textMuted }}>Default Incidents</span>
              <span
                style={{
                  fontWeight: 600,
                  color: portfolio.defaultedPositions > 0 ? '#ef4444' : textPrimary,
                }}
              >
                {portfolio.defaultedPositions}
              </span>
            </div>
          </div>
        )}

        {/* Interactive Yield Estimator */}
        <div
          style={{
            background: calculatorBg,
            borderRadius: '10px',
            padding: '20px',
            border: `1px solid ${border}`,
          }}
        >
          <h4
            style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 600, color: textPrimary }}
          >
            Interactive LP Yield Calculator
          </h4>

          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}
          >
            {/* Principal Slider */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                  marginBottom: '6px',
                }}
              >
                <span style={{ color: textMuted }}>Simulated Capital (USDC)</span>
                <span style={{ fontWeight: 700, color: textPrimary }}>
                  ${calcPrincipal.toLocaleString()}
                </span>
              </div>
              <input
                type="range"
                min="100"
                max="50000"
                step="100"
                value={calcPrincipal}
                onChange={(e) => setCalcPrincipal(Number(e.target.value))}
                className="iln-calc-slider"
              />
            </div>

            {/* APY Slider */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                  marginBottom: '6px',
                }}
              >
                <span style={{ color: textMuted }}>Simulated ROI / Discount Rate</span>
                <span style={{ fontWeight: 700, color: accentColor }}>{calcApy.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min="1"
                max="25"
                step="0.1"
                value={calcApy}
                onChange={(e) => setCalcApy(Number(e.target.value))}
                className="iln-calc-slider"
              />
            </div>
          </div>

          {/* Calculator Output Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              background: inputBg,
              borderRadius: '8px',
              padding: '12px',
              textAlign: 'center',
              border: `1px solid ${border}`,
            }}
          >
            <div>
              <div style={{ fontSize: '11px', color: textMuted, textTransform: 'uppercase' }}>
                Weekly
              </div>
              <div
                style={{ fontSize: '15px', fontWeight: 700, marginTop: '4px', color: textPrimary }}
              >
                ${calculatedYield.weekly.toFixed(2)}
              </div>
            </div>
            <div style={{ borderLeft: `1px solid ${border}`, borderRight: `1px solid ${border}` }}>
              <div style={{ fontSize: '11px', color: textMuted, textTransform: 'uppercase' }}>
                Monthly
              </div>
              <div
                style={{ fontSize: '15px', fontWeight: 700, marginTop: '4px', color: textPrimary }}
              >
                ${calculatedYield.monthly.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: textMuted, textTransform: 'uppercase' }}>
                Yearly
              </div>
              <div
                style={{ fontSize: '15px', fontWeight: 700, marginTop: '4px', color: accentColor }}
              >
                ${calculatedYield.yearly.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

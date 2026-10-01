import React, { useEffect, useState } from 'react';

export interface StatsCardProps {
  /** The title/label of the statistic (e.g. "Total Value Locked") */
  title: string;
  /** The value of the statistic (e.g. "$12,450,00") */
  value: string | number;
  /** Optional subtitle/description text */
  description?: string;
  /** Optional icon component or node to show in the top right */
  icon?: React.ReactNode;
  /** Optional trend data to show performance comparison */
  trend?: {
    value: number;
    isPositive: boolean;
    label?: string;
  };
  /** Whether the card is in a loading/skeleton state */
  loading?: boolean;
  /** Custom CSS style overrides */
  style?: React.CSSProperties;
  /** Custom CSS class names */
  className?: string;
  /** Theme preference */
  theme?: 'light' | 'dark' | 'system';
  /** Accent color line at the top or on hover */
  accentColor?: string;
}

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  description,
  icon,
  trend,
  loading = false,
  style,
  className = '',
  theme = 'system',
  accentColor = '#6366f1',
}) => {
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
  const trendUpBg = isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)';
  const trendDownBg = isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)';
  const skeletonBg = isDark ? '#334155' : '#e2e8f0';

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes iln-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .5; }
        }
        .iln-stats-card-hover {
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.25s ease;
        }
        .iln-stats-card-hover:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px -5px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          border-color: ${accentColor} !important;
        }
      `,
        }}
      />
      <div
        className={`iln-stats-card-hover ${className}`}
        style={{
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: '12px',
          padding: '20px',
          boxSizing: 'border-box',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minWidth: '180px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          ...style,
        }}
      >
        {/* Accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            background: accentColor,
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
          }}
        />

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div
                style={{
                  width: '40%',
                  height: '14px',
                  background: skeletonBg,
                  borderRadius: '4px',
                  animation: 'iln-pulse 1.5s infinite',
                }}
              />
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  background: skeletonBg,
                  borderRadius: '50%',
                  animation: 'iln-pulse 1.5s infinite',
                }}
              />
            </div>
            <div
              style={{
                width: '70%',
                height: '28px',
                background: skeletonBg,
                borderRadius: '6px',
                animation: 'iln-pulse 1.5s infinite',
              }}
            />
            <div
              style={{
                width: '50%',
                height: '12px',
                background: skeletonBg,
                borderRadius: '4px',
                animation: 'iln-pulse 1.5s infinite',
              }}
            />
          </div>
        ) : (
          <>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    color: textMuted,
                    letterSpacing: '0.01em',
                  }}
                >
                  {title}
                </span>
                {icon && <span style={{ color: textMuted, display: 'inline-flex' }}>{icon}</span>}
              </div>
              <div
                style={{
                  fontSize: '28px',
                  fontWeight: 700,
                  color: textPrimary,
                  letterSpacing: '-0.02em',
                  margin: '4px 0',
                }}
              >
                {value}
              </div>
            </div>

            {(trend || description) && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginTop: '12px',
                  fontSize: '12px',
                }}
              >
                {trend && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      fontWeight: 600,
                      color: trend.isPositive ? '#22c55e' : '#ef4444',
                      background: trend.isPositive ? trendUpBg : trendDownBg,
                    }}
                  >
                    {trend.isPositive ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                        <polyline points="17 6 23 6 23 12"></polyline>
                      </svg>
                    ) : (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
                        <polyline points="17 18 23 18 23 12"></polyline>
                      </svg>
                    )}
                    {trend.value}%
                  </span>
                )}
                {trend?.label && <span style={{ color: textMuted }}>{trend.label}</span>}
                {!trend && description && <span style={{ color: textMuted }}>{description}</span>}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

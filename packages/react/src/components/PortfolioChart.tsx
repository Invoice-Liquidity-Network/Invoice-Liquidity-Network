import React, { useState, useEffect, useMemo } from 'react';

export interface ChartDataPoint {
  label: string;
  value: number;
}

export interface PortfolioChartProps {
  /** Array of data points to plot in the chart. If omitted, mock portfolio performance data is shown. */
  data?: ChartDataPoint[];
  /** The chart title (e.g. "Cumulative Yield Over Time") */
  title?: string;
  /** Fixed height of the chart container in pixels. Default: 240 */
  height?: number;
  /** Theme preference */
  theme?: 'light' | 'dark' | 'system';
  /** Main color of the line and gradient accent */
  accentColor?: string;
  /** Custom inline style overrides */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
  /** Callback when a data point is hovered */
  onHoverPoint?: (point: ChartDataPoint | null) => void;
}

const DEFAULT_MOCK_DATA: ChartDataPoint[] = [
  { label: 'Jan', value: 120 },
  { label: 'Feb', value: 340 },
  { label: 'Mar', value: 512 },
  { label: 'Apr', value: 890 },
  { label: 'May', value: 1100 },
  { label: 'Jun', value: 1450 },
  { label: 'Jul', value: 1980 },
];

export const PortfolioChart: React.FC<PortfolioChartProps> = ({
  data = DEFAULT_MOCK_DATA,
  title = 'Portfolio Yield Growth (USDC)',
  height = 240,
  theme = 'system',
  accentColor = '#3b82f6', // Indigo-blue default
  style,
  className = '',
  onHoverPoint,
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
  const gridLines = isDark ? '#334155' : '#f1f5f9';

  // ── Tooltip state ────────────────────────────────────────────────────────
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // SVG dimensions
  const svgWidth = 500;
  const svgHeight = 200;
  const paddingLeft = 45;
  const paddingRight = 15;
  const paddingTop = 25;
  const paddingBottom = 30;

  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  // Max / Min values
  const { max, min } = useMemo(() => {
    if (data.length === 0) return { max: 100, min: 0 };
    const values = data.map((d) => d.value);
    const maximum = Math.max(...values) * 1.1; // Add 10% padding on top
    const minimum = Math.min(...values) * 0.9 > 0 ? Math.min(...values) * 0.9 : 0;
    return { max: maximum, min: minimum };
  }, [data]);

  // Map coordinates
  const points = useMemo(() => {
    if (data.length === 0) return [];
    return data.map((d, index) => {
      const x = paddingLeft + (index / (data.length - 1)) * chartWidth;
      // Invert Y coordinate since SVG (0,0) starts at top-left
      const ratio = max === min ? 0.5 : (d.value - min) / (max - min);
      const y = paddingTop + chartHeight - ratio * chartHeight;
      return { x, y, data: d };
    });
  }, [data, max, min, chartWidth, chartHeight]);

  // Generate SVG path string (for line)
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((path, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${path} L ${p.x} ${p.y}`;
    }, '');
  }, [points]);

  // Generate Area Path string (fills bottom half)
  const areaPath = useMemo(() => {
    if (points.length === 0) return '';
    const startPoint = points[0];
    const endPoint = points[points.length - 1];
    const bottomY = paddingTop + chartHeight;
    return `${linePath} L ${endPoint.x} ${bottomY} L ${startPoint.x} ${bottomY} Z`;
  }, [points, linePath, chartHeight]);

  const handlePointHover = (index: number | null) => {
    setHoveredIndex(index);
    if (index !== null && points[index]) {
      onHoverPoint?.(points[index].data);
    } else {
      onHoverPoint?.(null);
    }
  };

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes iln-draw {
          to { stroke-dashoffset: 0; }
        }
        .iln-chart-line {
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
          animation: iln-draw 2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .iln-chart-dot {
          transition: r 0.15s ease, fill 0.15s ease;
        }
        .iln-chart-dot:hover {
          r: 7px;
          fill: ${accentColor};
          cursor: pointer;
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
          padding: '20px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: textPrimary,
          boxSizing: 'border-box',
          width: '100%',
          ...style,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{title}</h3>
          {hoveredIndex !== null && points[hoveredIndex] && (
            <div style={{ fontSize: '13px', fontWeight: 700, color: accentColor }}>
              {points[hoveredIndex].data.label}: {points[hoveredIndex].data.value.toLocaleString()}{' '}
              USDC
            </div>
          )}
        </div>

        <div style={{ position: 'relative', width: '100%', height: `${height}px` }}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            width="100%"
            height="100%"
            style={{ overflow: 'visible' }}
          >
            <defs>
              <linearGradient id={`gradient-${accentColor}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity="0.3" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid Lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
              const y = paddingTop + ratio * chartHeight;
              const value = max - ratio * (max - min);
              return (
                <g key={index}>
                  <line
                    x1={paddingLeft}
                    y1={y}
                    x2={svgWidth - paddingRight}
                    y2={y}
                    stroke={gridLines}
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={y + 4}
                    fill={textMuted}
                    fontSize="9"
                    textAnchor="end"
                  >
                    {Math.round(value).toLocaleString()}
                  </text>
                </g>
              );
            })}

            {/* Area under the line */}
            {areaPath && <path d={areaPath} fill={`url(#gradient-${accentColor})`} />}

            {/* Main Path Line */}
            {linePath && (
              <path
                className="iln-chart-line"
                d={linePath}
                fill="none"
                stroke={accentColor}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* X-axis labels */}
            {points.map((p, index) => {
              // Show max 8 labels to prevent cluttering
              const interval = Math.ceil(data.length / 8);
              if (index % interval !== 0 && index !== data.length - 1) return null;

              return (
                <text
                  key={index}
                  x={p.x}
                  y={svgHeight - paddingBottom + 16}
                  fill={textMuted}
                  fontSize="10"
                  textAnchor="middle"
                >
                  {p.data.label}
                </text>
              );
            })}

            {/* Dots on Hover */}
            {points.map((p, index) => (
              <circle
                key={index}
                className="iln-chart-dot"
                cx={p.x}
                cy={p.y}
                r={hoveredIndex === index ? 6 : 4}
                fill={hoveredIndex === index ? accentColor : bg}
                stroke={accentColor}
                strokeWidth="2"
                onMouseEnter={() => handlePointHover(index)}
                onMouseLeave={() => handlePointHover(null)}
              />
            ))}
          </svg>
        </div>
      </div>
    </>
  );
};

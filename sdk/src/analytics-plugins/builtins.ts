import type { AnalyticsPlugin, WidgetRenderResult } from '../plugins';

const YIELD_TRACKER_PLUGIN: AnalyticsPlugin = {
  id: 'iln-yield-tracker',
  name: 'Yield Tracker',
  version: '1.0.0',
  description: 'Historical yield curves by token and time period',
  icon: '📈',
  metrics: [
    {
      id: 'avg-yield-bps',
      name: 'Average Yield (bps)',
      description: 'Weighted average discount rate across the top LPs by yield',
      type: 'number',
      compute: async (ctx) => {
        const stats = await ctx.sdk.getProtocolStats();
        const topLps = await ctx.sdk.getTopLPs(100, 'all');
        const totalYield = topLps.reduce((sum, lp) => sum + lp.yield, 0n);
        return Number(totalYield) > 0 && Number(stats.totalVolume) > 0
          ? Math.round((Number(totalYield) / Number(stats.totalVolume)) * 10000)
          : 0;
      },
    },
    {
      id: 'total-yield',
      name: 'Total Yield Earned',
      description: 'Cumulative yield earned by the top 100 LPs',
      type: 'currency',
      compute: async (ctx) => {
        const topLps = await ctx.sdk.getTopLPs(100, 'all');
        return topLps.reduce((sum, lp) => sum + lp.yield, 0n);
      },
    },
    {
      id: 'yield-growth',
      name: 'Yield Growth Rate',
      description: 'Month-over-month yield growth percentage',
      type: 'percentage',
      compute: async (ctx) => {
        const topLps = await ctx.sdk.getTopLPs(100, 'month');
        const prevLps = ctx.fetchFromCache<{ total: bigint }>('prev-month-yield');
        const currentTotal = topLps.reduce((sum, lp) => sum + lp.yield, 0n);
        ctx.setCache('prev-month-yield', { total: currentTotal }, 86400000);
        if (!prevLps || prevLps.total === 0n) return 0;
        const growth = (Number(currentTotal - prevLps.total) / Number(prevLps.total)) * 100;
        return Math.round(growth * 100) / 100;
      },
    },
  ],
  widgets: [
    {
      id: 'yield-curve-chart',
      name: 'Yield Curve History',
      description: 'Historical yield rates over time by token',
      type: 'chart',
      size: 'large',
      refreshIntervalMs: 60000,
      render: async (ctx): Promise<WidgetRenderResult> => {
        const topLps = await ctx.sdk.getTopLPs(20, 'all');
        const stats = await ctx.sdk.getProtocolStats();
        const totalYield = topLps.reduce((sum, lp) => sum + lp.yield, 0n);
        const avgYield =
          Number(totalYield) > 0 && Number(stats.totalVolume) > 0
            ? Math.round((Number(totalYield) / Number(stats.totalVolume)) * 10000)
            : 0;
        return {
          type: 'chart',
          data: { totalVolume: stats.totalVolume, totalYield, avgYieldBps: avgYield },
          series: [{ name: 'Top LPs Yield', values: topLps.map((lp) => Number(lp.yield)) }],
          labels: topLps.map((lp) => lp.address.slice(0, 6) + '...'),
          metadata: { period: 'all', avgYieldBps: avgYield },
        };
      },
    },
    {
      id: 'yield-summary',
      name: 'Yield Summary',
      description: 'Key yield metrics at a glance',
      type: 'metric',
      size: 'small',
      refreshIntervalMs: 30000,
      render: async (ctx): Promise<WidgetRenderResult> => {
        const stats = await ctx.sdk.getProtocolStats();
        const topLps = await ctx.sdk.getTopLPs(100, 'all');
        const totalYield = topLps.reduce((sum, lp) => sum + lp.yield, 0n);
        const avgYield =
          Number(totalYield) > 0 && Number(stats.totalVolume) > 0
            ? Math.round((Number(totalYield) / Number(stats.totalVolume)) * 10000)
            : 0;
        return {
          type: 'metric',
          data: {
            totalYield: Number(totalYield) / 10_000_000,
            avgYieldBps: avgYield,
            totalVolume: Number(stats.totalVolume) / 10_000_000,
            yieldRate:
              Number(stats.totalVolume) > 0
                ? ((Number(totalYield) / Number(stats.totalVolume)) * 100).toFixed(2) + '%'
                : '0.00%',
          },
          metadata: { unit: 'USDC' },
        };
      },
    },
  ],
};

const VOLUME_MONITOR_PLUGIN: AnalyticsPlugin = {
  id: 'iln-volume-monitor',
  name: 'Volume Monitor',
  version: '1.0.0',
  description: 'Daily, weekly, and monthly volume charts for invoice funding',
  icon: '📊',
  metrics: [
    {
      id: 'total-volume',
      name: 'Total Volume',
      description: 'All-time invoice volume',
      type: 'currency',
      compute: async (ctx) => {
        const stats = await ctx.sdk.getProtocolStats();
        return stats.totalVolume;
      },
    },
    {
      id: 'invoice-count',
      name: 'Total Invoices',
      description: 'Number of invoices indexed',
      type: 'number',
      compute: async (ctx) => {
        const stats = await ctx.sdk.getProtocolStats();
        return stats.totalInvoices;
      },
    },
    {
      id: 'avg-invoice-size',
      name: 'Avg Invoice Size',
      description: 'Average invoice amount',
      type: 'currency',
      compute: async (ctx) => {
        const stats = await ctx.sdk.getProtocolStats();
        return stats.totalInvoices > 0 ? stats.totalVolume / BigInt(stats.totalInvoices) : 0n;
      },
    },
  ],
  widgets: [
    {
      id: 'volume-overview',
      name: 'Volume Overview',
      description: 'Volume trends across time periods',
      type: 'chart',
      size: 'large',
      refreshIntervalMs: 60000,
      render: async (ctx): Promise<WidgetRenderResult> => {
        const [stats, weeklyLps, monthlyLps] = await Promise.all([
          ctx.sdk.getProtocolStats(),
          ctx.sdk.getTopLPs(10, 'week'),
          ctx.sdk.getTopLPs(10, 'month'),
        ]);
        return {
          type: 'chart',
          data: {
            totalVolume: stats.totalVolume,
            totalInvoices: stats.totalInvoices,
          },
          series: [
            { name: 'Weekly Top LPs', values: weeklyLps.map((lp) => Number(lp.yield)) },
            { name: 'Monthly Top LPs', values: monthlyLps.map((lp) => Number(lp.yield)) },
          ],
          labels: weeklyLps.map((lp) => lp.address.slice(0, 6) + '...'),
          metadata: {
            totalVolume: Number(stats.totalVolume) / 10_000_000,
            totalInvoices: stats.totalInvoices,
          },
        };
      },
    },
    {
      id: 'volume-metrics',
      name: 'Volume Metrics',
      description: 'Key volume statistics',
      type: 'metric',
      size: 'small',
      refreshIntervalMs: 30000,
      render: async (ctx): Promise<WidgetRenderResult> => {
        const stats = await ctx.sdk.getProtocolStats();
        const avgAmount =
          stats.totalInvoices > 0
            ? Number(stats.totalVolume / BigInt(stats.totalInvoices)) / 10_000_000
            : 0;
        return {
          type: 'metric',
          data: {
            totalVolumeUsdc: Number(stats.totalVolume) / 10_000_000,
            totalInvoices: stats.totalInvoices,
            avgInvoiceUsdc: avgAmount,
          },
        };
      },
    },
  ],
};

const PAYER_ANALYSIS_PLUGIN: AnalyticsPlugin = {
  id: 'iln-payer-analysis',
  name: 'Payer Analysis',
  version: '1.0.0',
  description: 'Payer reliability heatmaps and reputation tracking',
  icon: '🔍',
  metrics: [
    {
      id: 'default-rate',
      name: 'Protocol Default Rate',
      description: 'Percentage of invoices that defaulted',
      type: 'percentage',
      defaultValue: 0,
      compute: async () => {
        // ContractStats doesn't track a defaulted-invoice count, so this
        // is not yet computable from protocol stats. Stubbed like
        // reliable-payer-count below pending a dedicated contract counter.
        return 0;
      },
    },
    {
      id: 'reliable-payer-count',
      name: 'Reliable Payers (est.)',
      description: 'Estimated count of payers with high reliability',
      type: 'number',
      defaultValue: 0,
      compute: async () => {
        return 0;
      },
    },
  ],
  widgets: [
    {
      id: 'payer-reliability',
      name: 'Payer Reliability',
      description: 'Default rate and reliability indicators',
      type: 'metric',
      size: 'medium',
      refreshIntervalMs: 60000,
      render: async (ctx): Promise<WidgetRenderResult> => {
        const topLps = await ctx.sdk.getTopLPs(5, 'all');
        // ContractStats doesn't track a defaulted-invoice count, so
        // default rate / reliability score aren't yet computable.
        return {
          type: 'metric',
          data: {
            defaultRate: 'N/A',
            reliabilityScore: null,
            activeFunders: topLps.length,
          },
          metadata: { maxScore: 100 },
        };
      },
    },
    {
      id: 'payer-heatmap',
      name: 'Payer Activity Heatmap',
      description: 'Payer settlement patterns and timing',
      type: 'heatmap',
      size: 'large',
      refreshIntervalMs: 120000,
      render: async (ctx): Promise<WidgetRenderResult> => {
        const topLps = await ctx.sdk.getTopLPs(10, 'all');
        return {
          type: 'heatmap',
          data: {
            rows: topLps.map((lp) => ({
              label: lp.address.slice(0, 6) + '...',
              value: Number(lp.yield) / 10_000_000,
              volume: lp.invoiceCount,
            })),
          },
          labels: topLps.map((lp) => lp.address.slice(0, 6) + '...'),
          metadata: { metric: 'yield', period: 'all' },
        };
      },
    },
  ],
};

const LP_PERFORMANCE_PLUGIN: AnalyticsPlugin = {
  id: 'iln-lp-performance',
  name: 'LP Performance',
  version: '1.0.0',
  description: 'Portfolio performance tracking vs benchmarks',
  icon: '🏆',
  metrics: [
    {
      id: 'active-lps',
      name: 'Active LPs',
      description: 'Number of active liquidity providers',
      type: 'number',
      compute: async (ctx) => {
        const top = await ctx.sdk.getTopLPs(100, 'all');
        return top.length;
      },
    },
    {
      id: 'top-lp-yield',
      name: 'Top LP Yield',
      description: 'Highest yield among all LPs',
      type: 'currency',
      compute: async (ctx) => {
        const top = await ctx.sdk.getTopLPs(1, 'all');
        return top.length > 0 ? top[0].yield : 0n;
      },
    },
    {
      id: 'avg-lp-yield',
      name: 'Average LP Yield',
      description: 'Mean yield across all LPs',
      type: 'currency',
      compute: async (ctx) => {
        const top = await ctx.sdk.getTopLPs(100, 'all');
        if (top.length === 0) return 0n;
        const total = top.reduce((sum, lp) => sum + lp.yield, 0n);
        return total / BigInt(top.length);
      },
    },
  ],
  widgets: [
    {
      id: 'lp-rankings',
      name: 'LP Rankings',
      description: 'Top LPs ranked by yield and volume',
      type: 'table',
      size: 'large',
      refreshIntervalMs: 60000,
      render: async (ctx): Promise<WidgetRenderResult> => {
        const top = await ctx.sdk.getTopLPs(20, 'all');
        return {
          type: 'table',
          data: top.map((lp, i) => ({
            rank: i + 1,
            address: lp.address,
            yieldUsdc: Number(lp.yield) / 10_000_000,
            invoiceCount: lp.invoiceCount,
          })),
          labels: ['Rank', 'Address', 'Yield (USDC)', 'Invoices'],
          metadata: { sortedBy: 'yield', direction: 'desc' },
        };
      },
    },
    {
      id: 'lp-performance-summary',
      name: 'LP Performance Summary',
      description: 'Aggregate LP performance metrics',
      type: 'metric',
      size: 'small',
      refreshIntervalMs: 30000,
      render: async (ctx): Promise<WidgetRenderResult> => {
        const top = await ctx.sdk.getTopLPs(100, 'all');
        const totalYield = top.reduce((sum, lp) => sum + lp.yield, 0n);
        const avgYield = top.length > 0 ? totalYield / BigInt(top.length) : 0n;
        const totalInvoices = top.reduce((sum, lp) => sum + lp.invoiceCount, 0);
        return {
          type: 'metric',
          data: {
            activeLps: top.length,
            totalYieldUsdc: Number(totalYield) / 10_000_000,
            avgYieldUsdc: Number(avgYield) / 10_000_000,
            totalInvoicesFunded: totalInvoices,
          },
        };
      },
    },
    {
      id: 'lp-benchmark-chart',
      name: 'LP Benchmark Comparison',
      description: 'Individual LP performance vs protocol average',
      type: 'chart',
      size: 'medium',
      refreshIntervalMs: 60000,
      render: async (ctx): Promise<WidgetRenderResult> => {
        const top = await ctx.sdk.getTopLPs(10, 'all');
        const avgYield =
          top.length > 0 ? top.reduce((sum, lp) => sum + lp.yield, 0n) / BigInt(top.length) : 0n;
        return {
          type: 'chart',
          data: { protocolAvg: avgYield },
          series: [
            { name: 'LP Yield', values: top.map((lp) => Number(lp.yield)) },
            { name: 'Protocol Avg', values: top.map(() => Number(avgYield)) },
          ],
          labels: top.map((lp) => lp.address.slice(0, 6) + '...'),
          metadata: { comparison: 'lp-vs-protocol-avg' },
        };
      },
    },
  ],
};

export const BUILTIN_ANALYTICS_PLUGINS: AnalyticsPlugin[] = [
  YIELD_TRACKER_PLUGIN,
  VOLUME_MONITOR_PLUGIN,
  PAYER_ANALYSIS_PLUGIN,
  LP_PERFORMANCE_PLUGIN,
];

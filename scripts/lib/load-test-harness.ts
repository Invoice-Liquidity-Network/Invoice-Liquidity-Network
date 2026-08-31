/**
 * Shared load-test harness extracted from scripts/load-test.ts.
 *
 * Provides the core logic for executing HTTP-based load tests against the
 * Indexer and Notifications services, collecting metrics, and generating
 * Markdown + JSON reports.
 *
 * Consumers:
 *   - scripts/load-test.ts           (CLI entrypoint)
 *   - scripts/load-test-indexer.ts   (thin wrapper)
 *   - scripts/load-test-notifications.ts (thin wrapper)
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TestRequest {
  name: string;
  path: string;
  method: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}

export interface RequestRecord {
  name: string;
  url: string;
  method: string;
  latency: number;
  status: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface LatencyPercentiles {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface EndpointStat {
  name: string;
  method: string;
  url: string;
  total: number;
  success: number;
  failed: number;
  successRate: number;
  min: number;
  max: number;
  avg: number;
  p95: number;
}

export interface LoadTestReport {
  metadata: {
    timestamp: string;
    service: string;
    durationSeconds: number;
    concurrency: number;
    totalRequests: number;
    successCount: number;
    failedCount: number;
    successRate: number;
    errorRate: number;
    rps: number;
  };
  thresholds: {
    avgLatencyMs: number;
    p95LatencyMs: number;
    errorRatePercent: number;
    minRps: number;
    passed: boolean;
    violations: string[];
  };
  latencies: LatencyPercentiles;
  endpoints: EndpointStat[];
  errors: Array<{ error: string; count: number }>;
  rawRequests: Array<{
    name: string;
    method: string;
    latency: number;
    status: number;
    success: boolean;
    error?: string;
  }>;
}

export interface LoadTestConfig {
  service: 'indexer' | 'notifications' | 'both';
  duration: number;
  concurrency: number;
  indexerUrl: string;
  notificationsUrl: string;
  p95Threshold: number;
  errorThreshold: number;
  avgThreshold: number;
  rpsThreshold: number;
}

// ── Colors ───────────────────────────────────────────────────────────────────

export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getRandomStellarAddress(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = 'G';
  for (let i = 0; i < 55; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function getIndexerRequests(baseUrl: string): TestRequest[] {
  const randomAddress = getRandomStellarAddress();
  const randomInvoiceId = Math.floor(Math.random() * 50) + 1;

  return [
    { name: 'Indexer Health', method: 'GET', path: `${baseUrl}/v1/health` },
    { name: 'Indexer Invoices List', method: 'GET', path: `${baseUrl}/v1/invoices?limit=10` },
    { name: 'Indexer Stats', method: 'GET', path: `${baseUrl}/v1/stats` },
    { name: 'Indexer Top LPs', method: 'GET', path: `${baseUrl}/v1/lps/top?limit=5` },
    { name: 'Indexer LP Stats', method: 'GET', path: `${baseUrl}/v1/lps/${randomAddress}/stats` },
    {
      name: 'Indexer Freelancer Stats',
      method: 'GET',
      path: `${baseUrl}/v1/freelancers/${randomAddress}/stats`,
    },
    {
      name: 'Indexer Invoice History',
      method: 'GET',
      path: `${baseUrl}/v1/history/${randomAddress}`,
    },
    {
      name: 'Indexer Get Invoice by ID',
      method: 'GET',
      path: `${baseUrl}/v1/invoice/${randomInvoiceId}`,
    },
    {
      name: 'Indexer GraphQL Health',
      method: 'POST',
      path: `${baseUrl}/graphql`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query { health { status db uptime } }' }),
    },
    {
      name: 'Indexer GraphQL Protocol Stats',
      method: 'POST',
      path: `${baseUrl}/graphql`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query { protocolStats { totalInvoices totalVolume totalYield defaultRate } }',
      }),
    },
    {
      name: 'Indexer GraphQL Top LPs',
      method: 'POST',
      path: `${baseUrl}/graphql`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query { topLPs(limit: 5, period: "all") { address yield invoiceCount } }',
      }),
    },
  ];
}

export function getNotificationRequests(baseUrl: string): TestRequest[] {
  const randomAddress = getRandomStellarAddress();
  const randomSubId = Math.floor(Math.random() * 20) + 1;
  const randomEmail = `loadtest_${Math.floor(Math.random() * 100000)}@iln-test.com`;

  return [
    { name: 'Notifications Health', method: 'GET', path: `${baseUrl}/health` },
    { name: 'Notifications Analytics', method: 'GET', path: `${baseUrl}/analytics` },
    {
      name: 'Notifications Channel Comparison',
      method: 'GET',
      path: `${baseUrl}/analytics/channel-comparison`,
    },
    { name: 'Notifications Trends', method: 'GET', path: `${baseUrl}/analytics/trends?days=7` },
    {
      name: 'Notifications Get Subscriptions',
      method: 'GET',
      path: `${baseUrl}/subscriptions/${randomAddress}`,
    },
    {
      name: 'Notifications Get Subscription Logs',
      method: 'GET',
      path: `${baseUrl}/subscriptions/${randomSubId}/logs`,
    },
    {
      name: 'Notifications Subscribe Webhook',
      method: 'POST',
      path: `${baseUrl}/subscribe`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stellar_address: randomAddress,
        channel: 'webhook',
        destination: `https://example.com/webhook/${Math.random().toString(36).substring(7)}`,
        triggers: ['invoice_funded', 'invoice_paid'],
        webhook_secret: 'loadtest-secret-key',
      }),
    },
    {
      name: 'Notifications Subscribe Email',
      method: 'POST',
      path: `${baseUrl}/subscribe`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stellar_address: randomAddress,
        channel: 'email',
        destination: randomEmail,
        triggers: ['invoice_funded', 'invoice_due_soon'],
      }),
    },
    {
      name: 'Notifications Test Webhook',
      method: 'POST',
      path: `${baseUrl}/test-webhook`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: randomSubId }),
    },
  ];
}

export async function executeRequest(
  req: TestRequest,
  timeoutMs = 5000
): Promise<{ status: number; ok: boolean; error?: string }> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  const fetchFn = (globalThis as any).fetch || fetch;

  try {
    const response = await fetchFn(req.path, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });

    await response.text();

    return {
      status: response.status,
      ok: response.ok,
    };
  } catch (err: any) {
    return {
      status: 0,
      ok: false,
      error: err.name === 'AbortError' ? 'Timeout' : err.message || String(err),
    };
  } finally {
    clearTimeout(id);
  }
}

export function calculatePercentiles(latencies: number[]): LatencyPercentiles {
  if (latencies.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  const getPercentile = (p: number) => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  };

  return {
    min,
    max,
    avg,
    p50: getPercentile(50),
    p90: getPercentile(90),
    p95: getPercentile(95),
    p99: getPercentile(99),
  };
}

// ── Core runner ──────────────────────────────────────────────────────────────

export async function runLoadTest(config: LoadTestConfig): Promise<LoadTestReport> {
  const results: RequestRecord[] = [];
  const testStartTime = Date.now();
  const testEndTime = testStartTime + config.duration * 1000;

  const runWorker = async (workerId: number) => {
    while (Date.now() < testEndTime) {
      const pool: TestRequest[] = [];
      if (config.service === 'indexer' || config.service === 'both') {
        pool.push(...getIndexerRequests(config.indexerUrl));
      }
      if (config.service === 'notifications' || config.service === 'both') {
        pool.push(...getNotificationRequests(config.notificationsUrl));
      }

      if (pool.length === 0) {
        throw new Error('Empty request pool configured');
      }

      const target = pool[Math.floor(Math.random() * pool.length)];
      const reqStart = Date.now();
      const response = await executeRequest(target);
      const latency = Date.now() - reqStart;

      results.push({
        name: target.name,
        url: target.path,
        method: target.method,
        latency,
        status: response.status,
        success: response.ok,
        error: response.error,
        timestamp: reqStart,
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  await Promise.all(Array.from({ length: config.concurrency }).map((_, idx) => runWorker(idx)));

  const testActualDurationMs = Date.now() - testStartTime;
  const testActualDurationSec = testActualDurationMs / 1000;

  // Compile Metrics
  const totalRequests = results.length;
  const successCount = results.filter((r) => r.success).length;
  const failedCount = totalRequests - successCount;
  const successRate = totalRequests > 0 ? (successCount / totalRequests) * 100 : 0;
  const errorRate = totalRequests > 0 ? (failedCount / totalRequests) * 100 : 0;
  const rps = testActualDurationSec > 0 ? totalRequests / testActualDurationSec : 0;

  const allLatencies = results.map((r) => r.latency);
  const globalPercentiles = calculatePercentiles(allLatencies);

  const endpointGroups = new Map<
    string,
    { latencies: number[]; success: number; failed: number; method: string; url: string }
  >();
  for (const r of results) {
    if (!endpointGroups.has(r.name)) {
      endpointGroups.set(r.name, {
        latencies: [],
        success: 0,
        failed: 0,
        method: r.method,
        url: r.url,
      });
    }
    const g = endpointGroups.get(r.name)!;
    g.latencies.push(r.latency);
    if (r.success) g.success++;
    else g.failed++;
  }

  const endpointStats: EndpointStat[] = Array.from(endpointGroups.entries()).map(([name, g]) => {
    const p = calculatePercentiles(g.latencies);
    return {
      name,
      method: g.method,
      url: g.url,
      total: g.latencies.length,
      success: g.success,
      failed: g.failed,
      successRate: g.latencies.length > 0 ? (g.success / g.latencies.length) * 100 : 0,
      min: p.min,
      max: p.max,
      avg: p.avg,
      p95: p.p95,
    };
  });

  const errorDetails = new Map<string, number>();
  for (const r of results) {
    if (!r.success) {
      const errStr = r.error || `HTTP Status ${r.status}`;
      errorDetails.set(errStr, (errorDetails.get(errStr) || 0) + 1);
    }
  }

  // Threshold checks
  const alerts: string[] = [];
  const thresholdsPassed = {
    avgLatency: true,
    p95Latency: true,
    errorRate: true,
    rps: true,
  };

  if (globalPercentiles.avg > config.avgThreshold) {
    thresholdsPassed.avgLatency = false;
    alerts.push(
      `Average response time (${globalPercentiles.avg.toFixed(2)}ms) exceeded threshold of ${
        config.avgThreshold
      }ms`
    );
  }
  if (globalPercentiles.p95 > config.p95Threshold) {
    thresholdsPassed.p95Latency = false;
    alerts.push(
      `95th percentile latency (${globalPercentiles.p95.toFixed(2)}ms) exceeded threshold of ${
        config.p95Threshold
      }ms`
    );
  }
  if (errorRate > config.errorThreshold) {
    thresholdsPassed.errorRate = false;
    alerts.push(
      `Error rate (${errorRate.toFixed(2)}%) exceeded threshold of ${config.errorThreshold}%`
    );
  }
  if (rps < config.rpsThreshold) {
    thresholdsPassed.rps = false;
    alerts.push(
      `Throughput (${rps.toFixed(2)} RPS) was below threshold of ${config.rpsThreshold} RPS`
    );
  }

  return {
    metadata: {
      timestamp: new Date().toISOString(),
      service: config.service,
      durationSeconds: testActualDurationSec,
      concurrency: config.concurrency,
      totalRequests,
      successCount,
      failedCount,
      successRate,
      errorRate,
      rps,
    },
    thresholds: {
      avgLatencyMs: config.avgThreshold,
      p95LatencyMs: config.p95Threshold,
      errorRatePercent: config.errorThreshold,
      minRps: config.rpsThreshold,
      passed: alerts.length === 0,
      violations: alerts,
    },
    latencies: globalPercentiles,
    endpoints: endpointStats,
    errors: Array.from(errorDetails.entries()).map(([error, count]) => ({ error, count })),
    rawRequests: results.map((r) => ({
      name: r.name,
      method: r.method,
      latency: r.latency,
      status: r.status,
      success: r.success,
      error: r.error,
    })),
  };
}

// ── Report formatting ────────────────────────────────────────────────────────

export function printReport(report: LoadTestReport): void {
  const { metadata, thresholds, latencies, endpoints } = report;

  console.log(`${colors.bright}${colors.cyan}=== LOAD TEST SUMMARY ===${colors.reset}`);
  console.log(`Elapsed Time:          ${metadata.durationSeconds.toFixed(2)}s`);
  console.log(`Total Requests:        ${metadata.totalRequests}`);
  console.log(`Successful Requests:   ${metadata.successCount}`);
  console.log(`Failed Requests:       ${metadata.failedCount}`);
  console.log(`Success Rate:          ${metadata.successRate.toFixed(2)}%`);
  console.log(`Error Rate:            ${metadata.errorRate.toFixed(2)}%`);
  console.log(`Throughput:            ${metadata.rps.toFixed(2)} req/sec`);
  console.log();
  console.log(`${colors.bright}${colors.cyan}=== LATENCY PERCENTILES ===${colors.reset}`);
  console.log(`Average:               ${latencies.avg.toFixed(2)} ms`);
  console.log(`Min:                   ${latencies.min.toFixed(2)} ms`);
  console.log(`p50 (Median):          ${latencies.p50.toFixed(2)} ms`);
  console.log(`p90:                   ${latencies.p90.toFixed(2)} ms`);
  console.log(`p95:                   ${latencies.p95.toFixed(2)} ms`);
  console.log(`p99:                   ${latencies.p99.toFixed(2)} ms`);
  console.log(`Max:                   ${latencies.max.toFixed(2)} ms`);
  console.log();

  console.log(`${colors.bright}${colors.cyan}=== ENDPOINT DETAILS ===${colors.reset}`);
  console.log(
    `%-35s %-6s %-8s %-12s %-10s %-10s`.replace(/%-?\d+s/g, (m) => {
      const len = parseInt(m.match(/\d+/)![0], 10);
      return `%- ${len}s`;
    }),
    'Endpoint Name',
    'Method',
    'Requests',
    'Success Rate',
    'Avg Latency',
    'p95 Latency'
  );
  console.log('-'.repeat(88));
  for (const s of endpoints) {
    console.log(
      `%-35s %-6s %-8d %-12s %-10s %-10s`,
      s.name.substring(0, 34),
      s.method,
      s.total,
      `${s.successRate.toFixed(1)}%`,
      `${s.avg.toFixed(1)}ms`,
      `${s.p95.toFixed(1)}ms`
    );
  }
  console.log();

  if (!thresholds.passed) {
    console.log(`${colors.bright}${colors.red}=== THRESHOLD ALERTS ===${colors.reset}`);
    for (const alert of thresholds.violations) {
      console.log(`${colors.red}⚠️  [ALERT] ${alert}${colors.reset}`);
    }
    console.log();
  } else {
    console.log(
      `${colors.bright}${colors.green}✅ All performance thresholds satisfied successfully!${colors.reset}\n`
    );
  }
}

export function writeMarkdownReport(report: LoadTestReport, reportPath: string): void {
  const { metadata, thresholds, latencies, endpoints, errors } = report;

  const statusBox =
    thresholds.violations.length > 0
      ? `> [!WARNING]
> **Performance thresholds breached!**
> The following SLA thresholds were violated during stress testing:
${thresholds.violations.map((a) => `> - ⚠️ ${a}`).join('\n')}`
      : `> [!NOTE]
> **Performance SLA validation passed!**
> All endpoints operated within normal limits and satisfied defined thresholds.`;

  const mdReport = `# Invoice Liquidity Network Load Test Report

This report summarizes stress testing metrics collected during simulated client traffic.

## Test Metadata
- **Date/Time:** ${metadata.timestamp}
- **Target Service:** \`${metadata.service}\`
- **Configured Duration:** ${metadata.durationSeconds.toFixed(2)} seconds
- **Concurrent Workers (VUs):** ${metadata.concurrency}
- **Total Requests Sent:** ${metadata.totalRequests}

---

${statusBox}

---

## Global Performance Metrics

| Metric | Measured Value | Threshold | Status |
|---|---|---|---|
| **Throughput** | ${metadata.rps.toFixed(2)} RPS | &ge; ${thresholds.minRps} RPS | ${
    thresholds.passed ? '✅ PASS' : '❌ FAIL'
  } |
| **Average Latency** | ${latencies.avg.toFixed(2)} ms | &le; ${thresholds.avgLatencyMs} ms | ${
    thresholds.passed ? '✅ PASS' : '❌ FAIL'
  } |
| **p95 Latency** | ${latencies.p95.toFixed(2)} ms | &le; ${thresholds.p95LatencyMs} ms | ${
    thresholds.passed ? '✅ PASS' : '❌ FAIL'
  } |
| **Error Rate** | ${metadata.errorRate.toFixed(2)}% | &le; ${thresholds.errorRatePercent}% | ${
    thresholds.passed ? '✅ PASS' : '❌ FAIL'
  } |

## Latency Percentiles

| Percentile | Latency (ms) |
|---|---|
| **Min** | ${latencies.min.toFixed(2)} ms |
| **p50 (Median)** | ${latencies.p50.toFixed(2)} ms |
| **p90** | ${latencies.p90.toFixed(2)} ms |
| **p95** | ${latencies.p95.toFixed(2)} ms |
| **p99** | ${latencies.p99.toFixed(2)} ms |
| **Max** | ${latencies.max.toFixed(2)} ms |

## Endpoint Summary

| Endpoint Name | Method | Total Requests | Success Rate | Avg Latency (ms) | p95 Latency (ms) |
|---|---|---|---|---|---|
${endpoints
  .map(
    (s) =>
      `| ${s.name} | \`${s.method}\` | ${s.total} | ${s.successRate.toFixed(2)}% | ${s.avg.toFixed(
        2
      )} ms | ${s.p95.toFixed(2)} ms |`
  )
  .join('\n')}

${
  errors.length > 0
    ? `## Error Breakdown

| Error Description / Status Code | Frequency |
|---|---|
${errors.map(({ error, count }) => `| ${error} | ${count} |`).join('\n')}`
    : ''
}

---
*Report generated automatically by the ILN load testing suite.*
`;

  try {
    writeFileSync(resolve(process.cwd(), reportPath), mdReport, 'utf-8');
    console.log(`${colors.bright}Markdown report saved to: ${reportPath}${colors.reset}`);
  } catch (err: any) {
    console.error(`${colors.red}Failed to write markdown report: ${err.message}${colors.reset}`);
  }
}

export function writeJsonReport(report: LoadTestReport, jsonPath: string): void {
  try {
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`${colors.bright}JSON raw log saved to:    ${jsonPath}${colors.reset}`);
  } catch (err: any) {
    console.error(`${colors.red}Failed to write JSON raw log: ${err.message}${colors.reset}`);
  }
}

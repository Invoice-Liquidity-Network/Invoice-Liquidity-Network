import { describe, expect, it } from 'vitest';

import {
  checkOracleStalenessThresholds,
  getOracleRequests,
  oracleServiceScenario,
  type LoadTestReport,
} from '../lib/load-test-harness';

function makeReport(overrides: Partial<LoadTestReport> = {}): LoadTestReport {
  return {
    metadata: {
      timestamp: new Date().toISOString(),
      service: 'oracle',
      durationSeconds: 10,
      concurrency: 5,
      totalRequests: 100,
      successCount: 100,
      failedCount: 0,
      successRate: 100,
      errorRate: 0,
      rps: 10,
    },
    thresholds: {
      avgLatencyMs: 200,
      p95LatencyMs: 500,
      errorRatePercent: 2,
      minRps: 10,
      passed: true,
      violations: [],
    },
    latencies: { min: 1, max: 10, avg: 5, p50: 5, p90: 8, p95: 9, p99: 10 },
    endpoints: [],
    errors: [],
    rawRequests: [],
    ...overrides,
  };
}

describe('oracle load-test scenario', () => {
  it('generates health probes plus verify requests with unique payers', () => {
    const requests = oracleServiceScenario('http://localhost:3010', 15, 75);

    // 75 requests/minute across 15 sources = 5 invoices per source
    expect(requests).toHaveLength(75);
    expect(requests.every((r) => r.method === 'POST')).toBe(true);
    expect(requests.every((r) => r.path === 'http://localhost:3010/v1/verify')).toBe(true);

    const payers = new Set(
      requests.map((r) => (JSON.parse(r.body as string) as { payer: string }).payer)
    );
    expect(payers.size).toBe(15);
  });

  it('exposes base oracle request set for health and verify', () => {
    const requests = getOracleRequests('http://localhost:3010');
    const names = requests.map((r) => r.name);
    expect(names).toContain('Oracle Health');
    expect(names).toContain('Oracle V1 Health');
    expect(names).toContain('Oracle Verify');
  });

  it('flags throughput below the staleness threshold', () => {
    const report = makeReport({
      metadata: { ...makeReport().metadata, rps: 0.1 },
    });
    const violations = checkOracleStalenessThresholds(report, {
      maxStaleAgeMs: 300000,
      verificationLatencySloMs: 3000,
      minThroughputRps: 0.5,
    });
    expect(violations.some((v) => v.includes('throughput'))).toBe(true);
  });

  it('flags verify latency above the verification SLO', () => {
    const report = makeReport({
      endpoints: [
        {
          name: 'Oracle Verify (0-0)',
          method: 'POST',
          url: 'http://localhost:3010/v1/verify',
          total: 10,
          success: 10,
          failed: 0,
          successRate: 100,
          min: 1,
          max: 5000,
          avg: 4000,
          p95: 4500,
        },
      ],
    });
    const violations = checkOracleStalenessThresholds(report, {
      maxStaleAgeMs: 300000,
      verificationLatencySloMs: 3000,
      minThroughputRps: 0.5,
    });
    expect(violations.some((v) => v.includes('latency'))).toBe(true);
  });
});

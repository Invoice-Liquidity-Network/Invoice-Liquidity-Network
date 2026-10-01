#!/usr/bin/env node

/**
 * Thin wrapper for indexer-only load tests.
 *
 * Delegates to the shared harness in `scripts/lib/load-test-harness.ts`.
 */

import {
  LoadTestConfig,
  TrafficShape,
  colors,
  runLoadTest,
  printReport,
  writeMarkdownReport,
  writeJsonReport,
} from './lib/load-test-harness';

function parseTrafficShape(): TrafficShape {
  const raw = process.argv.slice(2);
  const idx = raw.indexOf('--traffic-shape');
  const value = idx >= 0 ? raw[idx + 1] : 'uniform';
  if (value !== 'uniform' && value !== 'realistic') {
    console.error(`${colors.red}Invalid --traffic-shape "${value}". Must be "uniform" or "realistic".${colors.reset}`);
    process.exit(1);
  }
  return value as TrafficShape;
}

async function main(): Promise<void> {
  console.log('🚀 Starting Indexer Stress Test wrapper...');

  const config: LoadTestConfig = {
    service: 'indexer',
    trafficShape: parseTrafficShape(),
    duration: 10,
    concurrency: 5,
    indexerUrl: 'http://localhost:3001',
    notificationsUrl: 'http://localhost:4001',
    p95Threshold: 500,
    errorThreshold: 2,
    avgThreshold: 200,
    rpsThreshold: 10,
  };

  console.log(`${colors.bright}Target Service:${colors.reset} ${config.service.toUpperCase()}`);
  console.log(`${colors.bright}Traffic Shape:${colors.reset} ${config.trafficShape}`);
  console.log(`${colors.bright}Duration:${colors.reset} ${config.duration} seconds`);

  const report = await runLoadTest(config);
  printReport(report);
  writeMarkdownReport(report, 'load-test-report.md');
  writeJsonReport(report, 'load-test-results.json');

  process.exitCode = report.thresholds.passed ? 0 : 1;
}

main().catch((err) => {
  console.error(
    `${colors.red}Load test failed unexpectedly: ${
      err instanceof Error ? err.message : String(err)
    }${colors.reset}`
  );
  process.exit(1);
});

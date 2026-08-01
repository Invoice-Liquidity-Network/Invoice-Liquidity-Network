#!/usr/bin/env node

/**
 * Thin wrapper for indexer-only load tests.
 *
 * Delegates to the shared harness in `scripts/lib/load-test-harness.ts`.
 */

import { LoadTestConfig, colors, runLoadTest, printReport, writeMarkdownReport, writeJsonReport } from "./lib/load-test-harness";

async function main(): Promise<void> {
  console.log("🚀 Starting Indexer Stress Test wrapper...");

  const config: LoadTestConfig = {
    service: "indexer",
    duration: 10,
    concurrency: 5,
    indexerUrl: "http://localhost:3001",
    notificationsUrl: "http://localhost:4001",
    p95Threshold: 500,
    errorThreshold: 2,
    avgThreshold: 200,
    rpsThreshold: 10,
  };

  console.log(`${colors.bright}Target Service:${colors.reset} ${config.service.toUpperCase()}`);
  console.log(`${colors.bright}Duration:${colors.reset} ${config.duration} seconds`);

  const report = await runLoadTest(config);
  printReport(report);
  writeMarkdownReport(report, "load-test-report.md");
  writeJsonReport(report, "load-test-results.json");

  process.exitCode = report.thresholds.passed ? 0 : 1;
}

main().catch((err) => {
  console.error(`${colors.red}Load test failed unexpectedly: ${err instanceof Error ? err.message : String(err)}${colors.reset}`);
  process.exit(1);
});
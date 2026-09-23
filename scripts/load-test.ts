#!/usr/bin/env node

/**
 * CLI entrypoint for the ILN load test harness.
 *
 * Delegates to the shared `runLoadTest()` function in `scripts/lib/load-test-harness.ts`.
 */

import { parseArgs } from 'util';
import {
  LoadTestConfig,
  colors,
  runLoadTest,
  printReport,
  writeMarkdownReport,
  writeJsonReport,
} from './lib/load-test-harness';

function printUsage(): void {
  console.log(`
${colors.bright}${colors.cyan}ILN Load Testing Tool${colors.reset}
Usage: npx ts-node --esm scripts/load-test.ts [options]

Options:
  --service <indexer|notifications|both>   Target service to test (default: both)
  --duration <seconds>                     Duration of the stress test (default: 10)
  --concurrency <count>                    Number of concurrent workers (default: 5)
  --indexer-url <url>                      URL of the Indexer service (default: http://localhost:3001)
  --notifications-url <url>                URL of the Notifications service (default: http://localhost:4001)
  --report <filepath>                      Markdown report destination (default: load-test-report.md)
  --json <filepath>                        JSON raw log destination (default: load-test-results.json)

Threshold Alerts Settings:
  --p95-threshold <ms>                     95th percentile latency limit in ms (default: 500)
  --error-threshold <pct>                  Allowed error percentage (default: 2)
  --avg-threshold <ms>                     Average latency limit in ms (default: 200)
  --rps-threshold <count>                  Minimum required throughput (default: 10)
  -h, --help                               Show this help screen
`);
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs({
      options: {
        service: { type: 'string', default: 'both' },
        duration: { type: 'string', default: '10' },
        concurrency: { type: 'string', default: '5' },
        'indexer-url': { type: 'string', default: 'http://localhost:3001' },
        'notifications-url': { type: 'string', default: 'http://localhost:4001' },
        report: { type: 'string', default: 'load-test-report.md' },
        json: { type: 'string', default: 'load-test-results.json' },
        'p95-threshold': { type: 'string', default: '500' },
        'error-threshold': { type: 'string', default: '2' },
        'avg-threshold': { type: 'string', default: '200' },
        'rps-threshold': { type: 'string', default: '10' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err: any) {
    console.error(`${colors.red}Error parsing arguments: ${err.message}${colors.reset}`);
    printUsage();
    process.exit(1);
  }

  if (args.values.help) {
    printUsage();
    process.exit(0);
  }

  const config: LoadTestConfig = {
    service: (args.values.service || 'both') as any,
    duration: parseInt(args.values.duration || '10', 10),
    concurrency: parseInt(args.values.concurrency || '5', 10),
    indexerUrl: args.values['indexer-url'] || 'http://localhost:3001',
    notificationsUrl: args.values['notifications-url'] || 'http://localhost:4001',
    p95Threshold: parseFloat(args.values['p95-threshold'] || '500'),
    errorThreshold: parseFloat(args.values['error-threshold'] || '2'),
    avgThreshold: parseFloat(args.values['avg-threshold'] || '200'),
    rpsThreshold: parseFloat(args.values['rps-threshold'] || '10'),
  };

  if (!['indexer', 'notifications', 'both'].includes(config.service)) {
    console.error(
      `${colors.red}Invalid service value: ${config.service}. Must be "indexer", "notifications", or "both".${colors.reset}`
    );
    process.exit(1);
  }

  console.log(
    `\n${colors.bright}${colors.magenta}=== INITIATING INVOICE LIQUIDITY NETWORK LOAD TEST ===${colors.reset}`
  );
  console.log(`${colors.bright}Target Service:${colors.reset}   ${config.service.toUpperCase()}`);
  console.log(`${colors.bright}Duration:${colors.reset}         ${config.duration} seconds`);
  console.log(
    `${colors.bright}Concurrency:${colors.reset}      ${config.concurrency} concurrent workers`
  );
  if (config.service === 'indexer' || config.service === 'both') {
    console.log(`${colors.bright}Indexer URL:${colors.reset}      ${config.indexerUrl}`);
  }
  if (config.service === 'notifications' || config.service === 'both') {
    console.log(`${colors.bright}Notifications URL:${colors.reset} ${config.notificationsUrl}`);
  }
  console.log(
    `${colors.bright}Thresholds:${colors.reset}       Avg: ${config.avgThreshold}ms | p95: ${config.p95Threshold}ms | Error: ${config.errorThreshold}% | Min RPS: ${config.rpsThreshold}\n`
  );

  const report = await runLoadTest(config);
  printReport(report);
  writeMarkdownReport(report, args.values.report || 'load-test-report.md');
  writeJsonReport(report, args.values.json || 'load-test-results.json');

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

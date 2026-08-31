#!/usr/bin/env node
/**
 * ILN Performance Profiler
 *
 * Measures execution time and memory usage for SDK and CLI operations,
 * detects bottlenecks against configurable thresholds, and generates
 * Markdown + JSON reports.
 *
 * Usage:
 *   npx ts-node --esm scripts/profile.ts [options]
 *
 * Options:
 *   --iterations <n>         Number of iterations per operation (default: 50)
 *   --warmup <n>             Warmup iterations discarded from stats (default: 5)
 *   --slow-threshold <ms>    Flag operation as slow above this p95 (default: 100)
 *   --report <path>          Markdown report output (default: profile-report.md)
 *   --json <path>            JSON report output (default: profile-results.json)
 *   -h, --help               Show help
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'util';

// ── Types ────────────────────────────────────────────────────────────────────

interface OperationSample {
  durationMs: number;
  heapUsedBytes: number;
  externalBytes: number;
}

interface OperationStats {
  name: string;
  category: 'sdk' | 'cli' | 'utility';
  samples: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgHeapMb: number;
  peakHeapMb: number;
  isBottleneck: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function bytesToMb(b: number): number {
  return Math.round((b / 1024 / 1024) * 100) / 100;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(3)} ms`;
}

// ── Profiler core ─────────────────────────────────────────────────────────────

async function profileOperation(
  name: string,
  category: 'sdk' | 'cli' | 'utility',
  fn: () => Promise<void> | void,
  iterations: number,
  warmup: number,
  slowThresholdMs: number
): Promise<OperationStats> {
  const all: OperationSample[] = [];

  for (let i = 0; i < warmup + iterations; i++) {
    if (global.gc) global.gc();

    const memBefore = process.memoryUsage();
    const start = performance.now();

    await fn();

    const durationMs = performance.now() - start;
    const memAfter = process.memoryUsage();

    if (i >= warmup) {
      all.push({
        durationMs,
        heapUsedBytes: Math.max(0, memAfter.heapUsed - memBefore.heapUsed),
        externalBytes: Math.max(0, memAfter.external - memBefore.external),
      });
    }
  }

  const durations = all.map((s) => s.durationMs).sort((a, b) => a - b);
  const heaps = all.map((s) => s.heapUsedBytes);
  const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  const p95Ms = percentile(durations, 95);

  return {
    name,
    category,
    samples: all.length,
    minMs: durations[0],
    maxMs: durations[durations.length - 1],
    avgMs,
    p50Ms: percentile(durations, 50),
    p90Ms: percentile(durations, 90),
    p95Ms,
    p99Ms: percentile(durations, 99),
    avgHeapMb: bytesToMb(heaps.reduce((a, b) => a + b, 0) / heaps.length),
    peakHeapMb: bytesToMb(Math.max(...heaps)),
    isBottleneck: p95Ms > slowThresholdMs,
  };
}

// ── Operation definitions ────────────────────────────────────────────────────

function buildOperations(): {
  name: string;
  category: 'sdk' | 'cli' | 'utility';
  fn: () => void;
}[] {
  return [
    {
      name: 'JSON.parse large invoice payload',
      category: 'sdk',
      fn: () => {
        const payload = JSON.stringify(
          Array.from({ length: 100 }, (_, i) => ({
            id: i,
            freelancer: `G${'A'.repeat(55)}`,
            payer: `G${'B'.repeat(55)}`,
            amount: Math.floor(Math.random() * 1_000_000_000).toString(),
            dueDate: Date.now() + 86400000,
            discountRate: 300,
            status: 'Pending',
            funder: null,
            fundedAt: null,
          }))
        );
        JSON.parse(payload);
      },
    },
    {
      name: 'Address truncation (100 addresses)',
      category: 'sdk',
      fn: () => {
        const addrs = Array.from({ length: 100 }, () => `G${'X'.repeat(55)}`);
        addrs.forEach((a) => `${a.slice(0, 6)}...${a.slice(-6)}`);
      },
    },
    {
      name: 'Amount formatting (1000 values)',
      category: 'sdk',
      fn: () => {
        const fmt = new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 7,
        });
        for (let i = 0; i < 1000; i++) {
          fmt.format((Math.random() * 1_000_000_000) / 1e7);
        }
      },
    },
    {
      name: 'Map lookup (10k invoice index)',
      category: 'utility',
      fn: () => {
        const map = new Map<number, string>();
        for (let i = 0; i < 10_000; i++) map.set(i, `invoice-${i}`);
        for (let i = 0; i < 10_000; i++) map.get(Math.floor(Math.random() * 10_000));
      },
    },
    {
      name: 'Date formatting (500 timestamps)',
      category: 'utility',
      fn: () => {
        const fmt = new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
        for (let i = 0; i < 500; i++) {
          fmt.format(new Date(Date.now() - Math.random() * 1e10));
        }
      },
    },
    {
      name: 'String template interpolation (5000x)',
      category: 'cli',
      fn: () => {
        for (let i = 0; i < 5000; i++) {
          const _s = `Invoice #${i}: amount=${((i * 100_000_000) / 1e7).toFixed(
            2
          )} XLM, status=Pending`;
        }
      },
    },
    {
      name: 'BigInt arithmetic (1000 calculations)',
      category: 'sdk',
      fn: () => {
        for (let i = 0; i < 1000; i++) {
          const amount = BigInt(Math.floor(Math.random() * 1_000_000_000));
          const discountRate = BigInt(300);
          const bps = BigInt(10_000);
          const _yield = (amount * discountRate) / bps;
        }
      },
    },
    {
      name: 'Array sort (500 invoices by amount)',
      category: 'sdk',
      fn: () => {
        const invoices = Array.from({ length: 500 }, (_, i) => ({
          id: i,
          amount: Math.floor(Math.random() * 1_000_000_000),
        }));
        invoices.sort((a, b) => b.amount - a.amount);
      },
    },
  ];
}

// ── Report generation ────────────────────────────────────────────────────────

function buildMarkdownReport(
  stats: OperationStats[],
  config: {
    iterations: number;
    warmup: number;
    slowThresholdMs: number;
  }
): string {
  const bottlenecks = stats.filter((s) => s.isBottleneck);
  const statusLine =
    bottlenecks.length === 0
      ? `> [!NOTE]\n> All operations completed within the ${config.slowThresholdMs} ms p95 threshold.`
      : `> [!WARNING]\n> **${bottlenecks.length} bottleneck(s) detected** (p95 > ${
          config.slowThresholdMs
        } ms):\n${bottlenecks
          .map((b) => `> - \`${b.name}\` — p95: ${formatMs(b.p95Ms)}`)
          .join('\n')}`;

  const categoryOrder = ['sdk', 'cli', 'utility'] as const;
  const rows = categoryOrder.flatMap((cat) =>
    stats
      .filter((s) => s.category === cat)
      .map((s) => {
        const flag = s.isBottleneck ? ' ⚠️' : '';
        return `| ${s.name}${flag} | \`${cat}\` | ${s.samples} | ${formatMs(s.avgMs)} | ${formatMs(
          s.p50Ms
        )} | ${formatMs(s.p95Ms)} | ${formatMs(s.p99Ms)} | ${s.avgHeapMb} MB | ${
          s.peakHeapMb
        } MB |`;
      })
  );

  return `# ILN Performance Profile Report

Generated: ${new Date().toISOString()}

## Configuration

| Parameter | Value |
|---|---|
| Iterations per operation | ${config.iterations} |
| Warmup iterations (discarded) | ${config.warmup} |
| Slow-operation threshold (p95) | ${config.slowThresholdMs} ms |

---

${statusLine}

---

## Results

| Operation | Category | Samples | Avg | p50 | p95 | p99 | Avg Heap | Peak Heap |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

---

## Summary

- Total operations profiled: **${stats.length}**
- Bottlenecks detected: **${bottlenecks.length}**
- Fastest operation: **${stats.reduce((a, b) => (a.avgMs < b.avgMs ? a : b)).name}** (${formatMs(
    stats.reduce((a, b) => (a.avgMs < b.avgMs ? a : b)).avgMs
  )} avg)
- Slowest operation: **${stats.reduce((a, b) => (a.avgMs > b.avgMs ? a : b)).name}** (${formatMs(
    stats.reduce((a, b) => (a.avgMs > b.avgMs ? a : b)).avgMs
  )} avg)

---
*Generated by the ILN performance profiling suite.*
`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

async function main() {
  let args;
  try {
    args = parseArgs({
      options: {
        iterations: { type: 'string', default: '50' },
        warmup: { type: 'string', default: '5' },
        'slow-threshold': { type: 'string', default: '100' },
        report: { type: 'string', default: 'profile-report.md' },
        json: { type: 'string', default: 'profile-results.json' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (args.values.help) {
    console.log(
      'Usage: npx ts-node --esm scripts/profile.ts [--iterations N] [--warmup N] [--slow-threshold MS] [--report FILE] [--json FILE]'
    );
    process.exit(0);
  }

  const iterations = parseInt(args.values['iterations'] ?? '50', 10);
  const warmup = parseInt(args.values['warmup'] ?? '5', 10);
  const slowThresholdMs = parseFloat(args.values['slow-threshold'] ?? '100');
  const reportPath = args.values['report'] ?? 'profile-report.md';
  const jsonPath = args.values['json'] ?? 'profile-results.json';

  console.log(`\n${colors.bright}${colors.cyan}=== ILN PERFORMANCE PROFILER ===${colors.reset}`);
  console.log(`Iterations:       ${iterations} (+ ${warmup} warmup)`);
  console.log(`Slow threshold:   ${slowThresholdMs} ms (p95)\n`);

  const operations = buildOperations();
  const allStats: OperationStats[] = [];

  for (const op of operations) {
    process.stdout.write(`  Profiling: ${op.name}... `);
    const stats = await profileOperation(
      op.name,
      op.category,
      op.fn,
      iterations,
      warmup,
      slowThresholdMs
    );
    allStats.push(stats);
    const flag = stats.isBottleneck
      ? `${colors.yellow}⚠ SLOW${colors.reset}`
      : `${colors.green}OK${colors.reset}`;
    console.log(`${flag} (avg: ${formatMs(stats.avgMs)}, p95: ${formatMs(stats.p95Ms)})`);
  }

  const bottlenecks = allStats.filter((s) => s.isBottleneck);
  console.log(`\n${colors.bright}${colors.cyan}=== PROFILE SUMMARY ===${colors.reset}`);
  console.log(`Operations:    ${allStats.length}`);
  console.log(
    `Bottlenecks:   ${
      bottlenecks.length > 0
        ? `${colors.yellow}${bottlenecks.length}${colors.reset}`
        : `${colors.green}0${colors.reset}`
    }`
  );

  if (bottlenecks.length > 0) {
    console.log(`\n${colors.yellow}Bottlenecks (p95 > ${slowThresholdMs} ms):${colors.reset}`);
    for (const b of bottlenecks) {
      console.log(`  ⚠  ${b.name}: p95=${formatMs(b.p95Ms)}`);
    }
  }

  const markdown = buildMarkdownReport(allStats, { iterations, warmup, slowThresholdMs });
  writeFileSync(resolve(process.cwd(), reportPath), markdown, 'utf-8');
  console.log(`\nMarkdown report: ${colors.bright}${reportPath}${colors.reset}`);

  const json = {
    generatedAt: new Date().toISOString(),
    config: { iterations, warmup, slowThresholdMs },
    bottleneckCount: bottlenecks.length,
    operations: allStats,
  };
  writeFileSync(resolve(process.cwd(), jsonPath), JSON.stringify(json, null, 2), 'utf-8');
  console.log(`JSON report:     ${colors.bright}${jsonPath}${colors.reset}\n`);

  process.exit(bottlenecks.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Profiler failed: ${err.message || err}`);
  process.exit(1);
});

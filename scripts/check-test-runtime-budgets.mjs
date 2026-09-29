#!/usr/bin/env node

/**
 * Per-package test-runtime budget enforcement (Issue #1092).
 *
 * Reads test-runtime-budgets.json and, for each budgeted package, sources its
 * measured test-suite duration and compares it against the configured budget:
 *
 *   - measuredVia: "turbo"    — looked up as the "<package>#test" task in a
 *     `turbo run test --summarize` run summary (execution.endTime -
 *     execution.startTime), passed via --turbo-summary=<path> (or the newest
 *     file under .turbo/runs/*.json if omitted).
 *   - measuredVia: "external" — the duration is supplied by the caller via
 *     --external <package>=<seconds> (for suites turbo doesn't track, e.g.
 *     the root scripts/__tests__ vitest run).
 *   - measuredVia: "external-bash" — enforced directly in a CI job's own
 *     shell step (currently only backend/, which has no Node/pnpm
 *     environment available). Listed in the config for the full-monorepo
 *     audit table; this script skips it rather than treating it as missing.
 *
 * BLOCKING: exits 1 if any budgeted package is over budget, or if a
 * "turbo"/"external" package has no measurement at all (nothing to compare
 * means the budget isn't actually being enforced for it).
 *
 * Usage:
 *   node scripts/check-test-runtime-budgets.mjs [--turbo-summary=<path>] [--external pkg=seconds ...] [--json=report.json]
 */

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const CONFIG_PATH = resolve(rootDir, 'test-runtime-budgets.json');

export function loadConfig(configPath = CONFIG_PATH) {
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

/**
 * Duration in seconds for `<package>#test` (or `<package>#test:coverage` as
 * a fallback) from a `turbo run test --summarize` run summary, or null if
 * that task isn't in the summary (e.g. the package has no "test" script, so
 * turbo silently skips it).
 */
export function durationFromTurboSummary(summary, packageName) {
  const tasks = summary.tasks ?? [];
  const task =
    tasks.find((t) => t.taskId === `${packageName}#test`) ??
    tasks.find((t) => t.taskId === `${packageName}#test:coverage`);
  if (!task || !task.execution) return null;
  const { startTime, endTime } = task.execution;
  if (typeof startTime !== 'number' || typeof endTime !== 'number') return null;
  return (endTime - startTime) / 1000;
}

/** Parses `pkg=12.3` CLI arguments into a Map<package, seconds>. */
export function parseExternalDurations(args) {
  const out = new Map();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--external' && args[i + 1]) {
      const [pkg, seconds] = args[++i].split('=');
      if (pkg && seconds) out.set(pkg, Number(seconds));
    }
  }
  return out;
}

export function buildFindings(budgets, { turboSummary, externalDurations }) {
  const findings = [];
  const rows = [];

  for (const budget of budgets) {
    if (budget.measuredVia === 'external-bash') {
      rows.push({ ...budget, durationSeconds: null, status: 'enforced-elsewhere' });
      continue;
    }

    let durationSeconds = null;
    if (budget.measuredVia === 'turbo') {
      durationSeconds = turboSummary ? durationFromTurboSummary(turboSummary, budget.package) : null;
    } else if (budget.measuredVia === 'external') {
      durationSeconds = externalDurations.has(budget.package) ? externalDurations.get(budget.package) : null;
    }

    if (durationSeconds === null) {
      findings.push({
        level: 'error',
        code: 'NO_MEASUREMENT',
        package: budget.package,
        message: `No measured duration found for "${budget.package}" (measuredVia: ${budget.measuredVia}). Nothing enforced its budget this run.`,
      });
      rows.push({ ...budget, durationSeconds: null, status: 'no-measurement' });
      continue;
    }

    const overBudget = durationSeconds > budget.budgetSeconds;
    if (overBudget) {
      findings.push({
        level: 'error',
        code: 'OVER_BUDGET',
        package: budget.package,
        message: `"${budget.package}" test suite took ${durationSeconds.toFixed(1)}s, exceeding its ${budget.budgetSeconds}s budget.`,
      });
    }
    rows.push({ ...budget, durationSeconds, status: overBudget ? 'over-budget' : 'ok' });
  }

  return { findings, rows };
}

function findLatestTurboSummary() {
  const runsDir = resolve(rootDir, '.turbo', 'runs');
  if (!existsSync(runsDir)) return null;
  const files = readdirSync(runsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(runsDir, f));
  if (files.length === 0) return null;
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

export async function run({ turboSummaryPath, externalDurations = new Map(), jsonPath = null } = {}) {
  const config = loadConfig();
  const summaryPath = turboSummaryPath ?? findLatestTurboSummary();
  const turboSummary = summaryPath && existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf-8')) : null;

  const { findings, rows } = buildFindings(config.budgets, { turboSummary, externalDurations });

  printReport(rows, findings, summaryPath);

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ rows, findings }, null, 2));
  }

  if (findings.length > 0) {
    process.exitCode = 1;
  }

  return { rows, findings };
}

function printReport(rows, findings, summaryPath) {
  console.log(`\nTest-runtime budget check — ${rows.length} budgeted package(s)`);
  console.log(summaryPath ? `Turbo summary: ${summaryPath}\n` : `Turbo summary: none found\n`);

  for (const row of rows) {
    if (row.status === 'enforced-elsewhere') {
      console.log(`⏭️  SKIP: ${row.package} — enforced separately (${row.measuredVia})`);
    } else if (row.status === 'no-measurement') {
      console.log(`❓ NO MEASUREMENT: ${row.package} (measuredVia: ${row.measuredVia}, budget ${row.budgetSeconds}s)`);
    } else if (row.status === 'over-budget') {
      console.error(`❌ OVER BUDGET: ${row.package} took ${row.durationSeconds.toFixed(1)}s (budget: ${row.budgetSeconds}s)`);
    } else {
      console.log(`✅ OK: ${row.package} took ${row.durationSeconds.toFixed(1)}s (budget: ${row.budgetSeconds}s)`);
    }
  }

  if (findings.length > 0) {
    console.error(
      `\n${findings.length} finding(s). If an increase is legitimate, update test-runtime-budgets.json and docs/test-runtime-budgets.md.`
    );
  } else {
    console.log('\nAll measured test suites are within budget.');
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  const args = process.argv.slice(2);
  const summaryArg = args.find((a) => a.startsWith('--turbo-summary='));
  const jsonArg = args.find((a) => a.startsWith('--json='));
  run({
    turboSummaryPath: summaryArg ? summaryArg.slice('--turbo-summary='.length) : undefined,
    externalDurations: parseExternalDurations(args),
    jsonPath: jsonArg ? jsonArg.slice('--json='.length) : null,
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

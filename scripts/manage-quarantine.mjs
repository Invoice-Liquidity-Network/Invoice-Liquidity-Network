#!/usr/bin/env node

/**
 * Manage flaky test quarantine: track history, detect repeats, auto-re-quarantine.
 *
 * Usage:
 *   node scripts/manage-quarantine.mjs record <test-file> <test-name> <reason>
 *   node scripts/manage-quarantine.mjs check <test-file> <test-name>
 *   node scripts/manage-quarantine.mjs report
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const historyFile = path.join(repoRoot, '.quarantine-history.json');

function loadHistory() {
  if (!fs.existsSync(historyFile)) {
    return {
      version: '1.0.0',
      last_updated: new Date().toISOString(),
      quarantine_metadata: {
        monitoring_window_runs: 10,
        re_quarantine_flake_threshold: 2,
        report_schedule: 'quarterly',
      },
      quarantined_tests: {},
    };
  }
  return JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
}

function saveHistory(history) {
  history.last_updated = new Date().toISOString();
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
}

function recordFlake(testFile, testName, reason) {
  const history = loadHistory();
  const testKey = `${testFile}:${testName}`;

  if (!history.quarantined_tests[testKey]) {
    history.quarantined_tests[testKey] = {
      name: testName,
      file: testFile,
      quarantine_count: 0,
      flake_count: 0,
      first_quarantined: new Date().toISOString(),
      last_un_quarantined: null,
      last_flake_date: new Date().toISOString(),
      last_flake_reason: reason,
      issue: null,
      monitoring_flake_count: 0,
      last_monitoring_reset: new Date().toISOString(),
    };
  }

  const test = history.quarantined_tests[testKey];
  test.flake_count = (test.flake_count || 0) + 1;
  test.monitoring_flake_count = (test.monitoring_flake_count || 0) + 1;
  test.last_flake_date = new Date().toISOString();
  test.last_flake_reason = reason;

  const { monitoring_window_runs, re_quarantine_flake_threshold } = history.quarantine_metadata;
  const shouldReQuarantine = test.monitoring_flake_count >= re_quarantine_flake_threshold;

  saveHistory(history);

  return {
    recorded: true,
    testKey,
    flake_count: test.flake_count,
    monitoring_flake_count: test.monitoring_flake_count,
    should_re_quarantine: shouldReQuarantine,
    re_quarantine_threshold: re_quarantine_flake_threshold,
  };
}

function checkStatus(testFile, testName) {
  const history = loadHistory();
  const testKey = `${testFile}:${testName}`;
  const test = history.quarantined_tests[testKey];

  if (!test) {
    return { found: false };
  }

  return {
    found: true,
    test,
    total_flakes: test.flake_count,
    recent_flakes: test.monitoring_flake_count,
    re_quarantine_count: test.quarantine_count,
  };
}

function generateReport() {
  const history = loadHistory();
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const longTermQuarantine = [];
  const highChurn = [];

  for (const [testKey, test] of Object.entries(history.quarantined_tests)) {
    const firstQuarantineDate = new Date(test.first_quarantined);
    const daysInQuarantine = Math.floor((now - firstQuarantineDate) / (1000 * 60 * 60 * 24));

    if (daysInQuarantine > 90) {
      longTermQuarantine.push({ testKey, test, daysInQuarantine });
    }

    if ((test.quarantine_count || 0) >= 3) {
      highChurn.push({ testKey, test });
    }
  }

  longTermQuarantine.sort((a, b) => b.daysInQuarantine - a.daysInQuarantine);
  highChurn.sort((a, b) => (b.test.quarantine_count || 0) - (a.test.quarantine_count || 0));

  const report = {
    generated: new Date().toISOString(),
    summary: {
      total_quarantined_tests: Object.keys(history.quarantined_tests).length,
      long_term_quarantine_count: longTermQuarantine.length,
      high_churn_count: highChurn.length,
    },
    long_term_quarantine: longTermQuarantine.map((item) => ({
      test: item.testKey,
      days_quarantined: item.daysInQuarantine,
      total_flakes: item.test.flake_count,
      re_quarantine_attempts: item.test.quarantine_count,
      issue: item.test.issue,
    })),
    high_churn: highChurn.map((item) => ({
      test: item.testKey,
      re_quarantine_attempts: item.test.quarantine_count,
      total_flakes: item.test.flake_count,
      last_flake: item.test.last_flake_date,
    })),
  };

  return report;
}

async function main() {
  const [command, arg1, arg2, arg3] = process.argv.slice(2);

  switch (command) {
    case 'record':
      if (!arg1 || !arg2 || !arg3) {
        console.error('Usage: manage-quarantine.mjs record <test-file> <test-name> <reason>');
        process.exit(1);
      }
      const result = recordFlake(arg1, arg2, arg3);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.should_re_quarantine ? 1 : 0);
      break;

    case 'check':
      if (!arg1 || !arg2) {
        console.error('Usage: manage-quarantine.mjs check <test-file> <test-name>');
        process.exit(1);
      }
      const status = checkStatus(arg1, arg2);
      console.log(JSON.stringify(status, null, 2));
      process.exit(0);
      break;

    case 'report':
      const report = generateReport();
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
      break;

    default:
      console.error('Unknown command:', command);
      console.error('Usage:');
      console.error('  manage-quarantine.mjs record <test-file> <test-name> <reason>');
      console.error('  manage-quarantine.mjs check <test-file> <test-name>');
      console.error('  manage-quarantine.mjs report');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});

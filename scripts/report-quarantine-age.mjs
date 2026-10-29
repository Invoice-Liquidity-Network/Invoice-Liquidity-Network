#!/usr/bin/env node

/**
 * Generate a quarterly report on quarantine age and churn.
 * Identifies tests in long-term quarantine and tests with high re-quarantine attempts.
 *
 * Usage:
 *   node scripts/report-quarantine-age.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const historyFile = path.join(repoRoot, '.quarantine-history.json');

function loadHistory() {
  if (!fs.existsSync(historyFile)) {
    console.error('Quarantine history file not found:', historyFile);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
}

function formatReport(report) {
  let output = '\n';
  output += '═════════════════════════════════════════════════════════════\n';
  output += 'Quarantine Age and Churn Report\n';
  output += '═════════════════════════════════════════════════════════════\n';
  output += `Generated: ${report.generated}\n\n`;

  output += `Summary:\n`;
  output += `  Total quarantined tests: ${report.summary.total_quarantined_tests}\n`;
  output += `  In long-term quarantine (>90 days): ${report.summary.long_term_quarantine_count}\n`;
  output += `  High churn (3+ re-quarantines): ${report.summary.high_churn_count}\n\n`;

  if (report.long_term_quarantine.length > 0) {
    output += 'Tests in long-term quarantine (>90 days):\n';
    output += '─────────────────────────────────────────────────────────────\n';
    for (const test of report.long_term_quarantine) {
      output += `  • ${test.test}\n`;
      output += `    Days in quarantine: ${test.days_quarantined}\n`;
      output += `    Total flakes: ${test.total_flakes}\n`;
      output += `    Re-quarantine attempts: ${test.re_quarantine_attempts}\n`;
      if (test.issue) {
        output += `    Issue: ${test.issue}\n`;
      }
      output += '\n';
    }
  }

  if (report.high_churn.length > 0) {
    output += 'Tests with high re-quarantine churn (3+ attempts):\n';
    output += '─────────────────────────────────────────────────────────────\n';
    for (const test of report.high_churn) {
      output += `  • ${test.test}\n`;
      output += `    Re-quarantine attempts: ${test.re_quarantine_attempts}\n`;
      output += `    Total flakes: ${test.total_flakes}\n`;
      output += `    Last flake: ${test.last_flake}\n`;
      output += '\n';
    }
  }

  if (report.long_term_quarantine.length === 0 && report.high_churn.length === 0) {
    output += 'No tests in long-term quarantine or with high churn.\n\n';
  }

  output += '═════════════════════════════════════════════════════════════\n\n';
  return output;
}

function main() {
  const history = loadHistory();
  const now = new Date();

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

  console.log(formatReport(report));

  const reportFile = path.join(repoRoot, '.quarantine-report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`Full report saved to: ${reportFile}\n`);

  process.exit(report.summary.long_term_quarantine_count > 0 || report.summary.high_churn_count > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});

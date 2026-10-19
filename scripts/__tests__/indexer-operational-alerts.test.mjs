import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAlertRules } from '../check-alert-runbook-links.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

describe('Indexer Operational Alerts Suite (#1319)', () => {
  const alertFilePath = join(repoRoot, 'monitoring/prometheus/indexer-operational-alerts.yml');
  const runbookPath = join(repoRoot, 'docs/incident-response.md');

  it('verifies indexer-operational-alerts.yml exists and defines canonical alerts', () => {
    assert.equal(existsSync(alertFilePath), true);
    const content = readFileSync(alertFilePath, 'utf-8');
    const alerts = parseAlertRules(content);

    assert.equal(alerts.length, 3);
    const alertNames = alerts.map((a) => a.name);
    assert.ok(alertNames.includes('ILNIndexerSlowQueryDurationHigh'));
    assert.ok(alertNames.includes('ILNIndexerLedgerCursorStalled'));
    assert.ok(alertNames.includes('ILNIndexerDatabaseErrorRateElevated'));
  });

  it('asserts all operational alerts have valid runbook URLs pointing to existing headings', () => {
    const content = readFileSync(alertFilePath, 'utf-8');
    const runbookContent = readFileSync(runbookPath, 'utf-8');
    const alerts = parseAlertRules(content);

    assert.ok(runbookContent.includes('### Scenario C: Indexer Performance Degradation'));

    for (const alert of alerts) {
      assert.ok(alert.runbookUrl, `Alert ${alert.name} missing runbookUrl`);
      assert.match(
        alert.runbookUrl,
        /#scenario-c-indexer-performance-degradation-slow-queries--ledger-cursor-stalled/
      );
    }
  });
});

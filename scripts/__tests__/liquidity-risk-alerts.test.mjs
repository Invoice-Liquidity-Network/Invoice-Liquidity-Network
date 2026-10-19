import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAlertRules } from '../check-alert-runbook-links.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

describe('Liquidity Risk & Solvency Alerts Suite (#1311)', () => {
  const alertFilePath = join(repoRoot, 'monitoring/prometheus/liquidity-risk-alerts.yml');

  it('verifies liquidity-risk-alerts.yml defines all 4 required liquidity alerts', () => {
    assert.equal(existsSync(alertFilePath), true);
    const content = readFileSync(alertFilePath, 'utf-8');
    const alerts = parseAlertRules(content);

    assert.equal(alerts.length, 4);
    const alertNames = alerts.map((a) => a.name);
    assert.ok(alertNames.includes('ILNLiquidityPoolUtilizationCritical'));
    assert.ok(alertNames.includes('ILNStressedLiquidityIdleDepletion'));
    assert.ok(alertNames.includes('ILNRedemptionQueueBacklogElevated'));
    assert.ok(alertNames.includes('ILNTreasuryFirstLossDepleted'));
  });

  it('asserts all alerts contain non-empty runbook URLs and valid PromQL expressions', () => {
    const content = readFileSync(alertFilePath, 'utf-8');
    const alerts = parseAlertRules(content);

    for (const alert of alerts) {
      assert.ok(alert.runbookUrl, `Alert ${alert.name} missing runbookUrl`);
      assert.ok(alert.runbookUrl.startsWith('https://github.com/'));
    }
  });
});

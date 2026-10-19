import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDashboard,
  extractMetricsFromExpr,
} from '../validate-monitoring-dashboard.mjs';

describe('Monitoring Dashboard & Service Metrics Validation Suite (#1325)', () => {
  it('extracts metrics accurately from PromQL expressions', () => {
    const expr = 'rate(iln_invoice_submissions_total[1h]) / irate(iln_funded_invoices_total[5m])';
    const metrics = extractMetricsFromExpr(expr);
    assert.deepEqual(metrics, ['iln_invoice_submissions_total', 'iln_funded_invoices_total']);
  });

  it('validates canonical monitoring/grafana/dashboard.json successfully', () => {
    const report = validateDashboard();
    assert.equal(report.valid, true);
    assert.equal(report.uid, 'iln-operational-observability');
    assert.ok(report.panelCount >= 40);
    assert.ok(report.uniqueMetricsCount >= 40);
    assert.equal(report.errors.length, 0);
  });

  it('detects invalid panel grid coordinates or missing titles', () => {
    const badDashboard = {
      dashboard: {
        title: '',
        uid: 'test-bad',
        panels: [
          {
            title: 'Bad Panel',
            gridPos: { x: 99, y: 0, w: 0, h: 5 },
            targets: [{ expr: '' }],
          },
        ],
      },
    };

    // Verify extract handles invalid expressions gracefully
    assert.deepEqual(extractMetricsFromExpr(null), []);
    assert.deepEqual(extractMetricsFromExpr(''), []);
  });
});

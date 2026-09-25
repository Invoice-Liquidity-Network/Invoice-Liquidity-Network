import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit, metricsIn, parseRules, renderMarkdown, loadInputs } from '../alert-audit.mjs';

const RULES = `
groups:
  - name: g
    rules:
      - record: slo:demo:ratio_5m
        expr: sum(rate(iln_http_errors_total[5m])) / sum(rate(iln_http_requests_total[5m]))
      - alert: DemoBurn
        expr: |
          slo:demo:ratio_5m > 0.1
          and
          slo:demo:ratio_5m > 0.2
        for: 5m
        labels:
          severity: critical
      - alert: ServiceDown
        expr: up == 0
        for: 2m
        labels:
          severity: critical
      - alert: Ghosted
        expr: rate(oracle_never_emitted_total[5m]) > 0
        for: 1m
        labels:
          severity: warning
`;

const METRICS = `
export const a = new Counter({ name: 'iln_http_errors_total' });
export const b = new Counter({ name: 'iln_http_requests_total' });
`;

const LEDGER = {
  incidents: [
    {
      id: 'i1',
      date: '2026-08-30',
      severity: 'P2',
      components: ['indexer'],
      detectedBy: ['upptime', 'ServiceDown'],
      expectedAlertClasses: ['service-down'],
    },
    {
      id: 'i2',
      date: '2026-08-30',
      severity: 'P1',
      components: ['oracle-service'],
      detectedBy: ['FrontendBadgeErrorSpike', 'DemoBurn'],
      expectedAlertClasses: ['integrity'],
      coverageGap: { status: 'accepted', reason: 'no metric' },
    },
    {
      id: 'i3',
      date: '2026-08-31',
      severity: 'P2',
      components: ['notifications'],
      detectedBy: [],
      expectedAlertClasses: ['degraded'],
    },
  ],
  alertClasses: {
    'service-down': { rules: ['ServiceDown'] },
    integrity: { rules: [] },
    degraded: { rules: ['NotificationsFallbackActive'] },
  },
  ruleDecisions: { Ghosted: { decision: 'removed', reason: 'never fires' } },
};

test('parseRules extracts names, severities, windows and multi-line expressions', () => {
  const { rules, recordings } = parseRules(RULES, 'demo.yml');
  assert.deepEqual(
    rules.map((r) => r.name),
    ['DemoBurn', 'ServiceDown', 'Ghosted']
  );
  assert.equal(rules[0].severity, 'critical');
  assert.equal(rules[0].for, '5m');
  assert.match(rules[0].expr, /ratio_5m > 0.1 and slo:demo:ratio_5m > 0.2/);
  assert.equal(rules[1].expr.trim(), 'up == 0');
  assert.deepEqual([...recordings], ['slo:demo:ratio_5m']);
});

test('metricsIn folds histogram suffixes and ignores builtins', () => {
  assert.deepEqual(
    metricsIn(
      'histogram_quantile(0.95, sum(rate(iln_http_request_duration_seconds_bucket[5m])) by (le)) > 0.2 and up == 1 and time() - iln_cursor_updated_at > 60'
    ),
    ['iln_http_request_duration_seconds', 'iln_cursor_updated_at']
  );
});

test('audit reports unknown metrics, ghost alerts, coverage, precision and recall', () => {
  const report = audit({
    ruleFiles: [{ file: 'demo.yml', text: RULES }],
    metricSources: [METRICS],
    ledger: LEDGER,
  });
  assert.deepEqual(report.unknownMetrics, [
    { rule: 'Ghosted', missing: ['oracle_never_emitted_total'] },
  ]);
  assert.deepEqual(report.ghostAlerts, ['FrontendBadgeErrorSpike']);
  assert.equal(report.coveredCount, 1);
  assert.deepEqual(report.uncovered, ['i3']); // i2 is an accepted gap
  assert.equal(report.recall, 1 / 3);
  // ServiceDown fired and covers i1 (correct); DemoBurn fired for i2 but covers nothing → 1 of 2 firing rules were right
  assert.equal(report.precision, 0.5);
  assert.deepEqual(report.neverFired, ['Ghosted']);
  const md = renderMarkdown(report);
  assert.match(md, /Recall: 33%/);
  assert.match(md, /Precision: 50%/);
  assert.match(
    md,
    /\| Ghosted \| demo.yml \| warning \| 1m \| oracle_never_emitted_total \| removed \|/
  );
  assert.match(md, /Incidents with no covering rule\n\n- i3/);
});

test('the repository rule set passes the audit', () => {
  const report = audit(loadInputs());
  assert.deepEqual(report.unknownMetrics, [], JSON.stringify(report.unknownMetrics));
  assert.deepEqual(report.uncovered, []);
  assert.ok(report.rules.some((r) => r.name === 'ServiceDown'));
  assert.ok(
    report.rules.every((r) => r.severity && r.for),
    'every rule declares severity and for'
  );
  assert.ok(report.incidents.length >= 4);
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAlertRules,
  githubAnchor,
  extractHeadingAnchors,
  buildFindings,
} from '../check-alert-runbook-links.mjs';

const SAMPLE_RULES = `groups:
  - name: sample
    interval: 30s
    rules:
      - alert: SomethingBad
        expr: up == 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "it broke"
          description: "it really broke"
          runbook_url: https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#somethingbad

      - alert: NoRunbookYet
        expr: up == 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "it also broke"

      - record: some:recording:rule
        expr: rate(x[5m])
`;

const SAMPLE_DOC = `# Runbook

## 3. Incident Scenarios

#### SomethingBad
- Trigger: it broke.
`;

describe('parseAlertRules', () => {
  it('extracts alert names and their runbook_url annotation', () => {
    const alerts = parseAlertRules(SAMPLE_RULES);
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].name, 'SomethingBad');
    assert.equal(
      alerts[0].runbookUrl,
      'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#somethingbad'
    );
    assert.equal(alerts[1].name, 'NoRunbookYet');
    assert.equal(alerts[1].runbookUrl, null);
  });

  it('does not pick up recording rules as alerts', () => {
    const alerts = parseAlertRules(SAMPLE_RULES);
    assert.ok(!alerts.some((a) => a.name === 'some:recording:rule'));
  });
});

describe('githubAnchor', () => {
  it('lowercases simple alert-name headings with no transformation needed', () => {
    assert.equal(githubAnchor('SomethingBad'), 'somethingbad');
    assert.equal(githubAnchor('OracleFraudFlagRateHigh'), 'oraclefraudflagratehigh');
  });

  it('converts spaces to hyphens and strips punctuation', () => {
    assert.equal(githubAnchor('3. Incident Scenarios'), '3-incident-scenarios');
  });
});

describe('extractHeadingAnchors', () => {
  it('collects anchors for every heading level', () => {
    const anchors = extractHeadingAnchors(SAMPLE_DOC);
    assert.ok(anchors.has('somethingbad'));
    assert.ok(anchors.has('3-incident-scenarios'));
  });
});

describe('buildFindings', () => {
  it('reports no findings when every alert resolves to an existing heading', () => {
    const alerts = parseAlertRules(SAMPLE_RULES)
      .filter((a) => a.name === 'SomethingBad')
      .map((a) => ({ ...a, file: 'monitoring/prometheus/sample.yml' }));
    const anchors = extractHeadingAnchors(SAMPLE_DOC);
    const findings = buildFindings(alerts, anchors);
    assert.equal(findings.length, 0);
  });

  it('flags an alert with no runbook_url', () => {
    const alerts = parseAlertRules(SAMPLE_RULES).map((a) => ({
      ...a,
      file: 'monitoring/prometheus/sample.yml',
    }));
    const anchors = extractHeadingAnchors(SAMPLE_DOC);
    const findings = buildFindings(alerts, anchors);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'MISSING_RUNBOOK_URL');
    assert.equal(findings[0].alert, 'NoRunbookYet');
  });

  it('flags a runbook_url whose anchor has no matching heading', () => {
    const alerts = [
      {
        name: 'GhostAlert',
        file: 'monitoring/prometheus/sample.yml',
        line: 1,
        runbookUrl:
          'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/incident-response.md#ghostalert',
      },
    ];
    const anchors = extractHeadingAnchors(SAMPLE_DOC);
    const findings = buildFindings(alerts, anchors);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'RUNBOOK_ANCHOR_MISSING');
  });

  it('flags a runbook_url pointing at the wrong document', () => {
    const alerts = [
      {
        name: 'WrongDocAlert',
        file: 'monitoring/prometheus/sample.yml',
        line: 1,
        runbookUrl: 'https://example.com/docs/monitoring.md#wrongdocalert',
      },
    ];
    const anchors = extractHeadingAnchors(SAMPLE_DOC);
    const findings = buildFindings(alerts, anchors);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'RUNBOOK_URL_WRONG_DOC');
  });
});

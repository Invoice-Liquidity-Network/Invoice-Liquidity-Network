import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditPostmortemSla, POSTMORTEM_SLA_HOURS } from '../enforce-postmortem-sla.mjs';

describe('Postmortem Filing SLA Enforcement Suite (#1106)', () => {
  it('correctly identifies filed postmortems and reports 100% compliance', () => {
    const report = auditPostmortemSla();
    assert.equal(report.slaHours, POSTMORTEM_SLA_HOURS);
    assert.equal(report.overdueCount, 0);
    assert.equal(report.complianceRatePercent, 100);
  });

  it('flags unfiled incidents past the 72-hour SLA window as OVERDUE_ESCALATE', () => {
    const fakeIncidents = [
      {
        id: 'INC-OLD-UNFILED',
        title: 'Unfiled Legacy Outage',
        severity: 'SEV-1',
        resolvedAt: new Date(Date.now() - 100 * 3600 * 1000).toISOString(), // 100 hours ago
        owner: '@sec-commander',
        postmortemFile: 'non-existent-file.md',
      },
      {
        id: 'INC-RECENT-UNFILED',
        title: 'Recent Fresh Outage',
        severity: 'SEV-2',
        resolvedAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(), // 10 hours ago (< 72h)
        owner: '@infra-leads',
        postmortemFile: 'non-existent-fresh.md',
      },
    ];

    const report = auditPostmortemSla(fakeIncidents);
    assert.equal(report.overdueCount, 1);
    assert.equal(report.escalationsRequired.length, 1);
    assert.equal(report.escalationsRequired[0].incidentId, 'INC-OLD-UNFILED');
    assert.equal(report.escalationsRequired[0].status, 'OVERDUE_ESCALATE');
    assert.equal(report.results.find((r) => r.incidentId === 'INC-RECENT-UNFILED').status, 'PENDING_WITHIN_SLA');
  });
});

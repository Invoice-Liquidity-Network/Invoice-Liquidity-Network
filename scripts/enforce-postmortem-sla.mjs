#!/usr/bin/env node

/**
 * Automated Postmortem Filing SLA Enforcement & Tracking Tool (#1106)
 *
 * Enforces an explicit 72-hour SLA for postmortem filing after incident resolution.
 * Scans incident records and postmortem repository, flags overdue incidents,
 * and escalates to incident response owners to prevent institutional knowledge loss.
 */

import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const POSTMORTEM_SLA_HOURS = 72; // 3 days SLA window

export const KNOWN_INCIDENTS = [
  {
    id: 'INC-2026-0830',
    title: 'Cross-Repo Game-Day Oracle Malfunction',
    severity: 'SEV-1',
    resolvedAt: '2026-08-30T16:00:00Z',
    owner: '@sec-commander',
    postmortemFile: '2026-08-30-cross-repo-game-day-oracle-malfunction.md',
  },
  {
    id: 'INC-2026-0928-RPC',
    title: 'RPC Node Outage System Drill',
    severity: 'SEV-2',
    resolvedAt: '2026-09-28T12:00:00Z',
    owner: '@infra-leads',
    postmortemFile: '2026-09-rpc-node-outage-drill.md',
  },
  {
    id: 'INC-2026-0928-MULTI',
    title: 'Multi-Service Outage Game-Day',
    severity: 'SEV-1',
    resolvedAt: '2026-09-28T13:00:00Z',
    owner: '@sec-commander',
    postmortemFile: '2026-09-multi-service-outage-game-day.md',
  },
];

export function auditPostmortemSla(
  incidents = KNOWN_INCIDENTS,
  nowTimestampMs = Date.now(),
  postmortemsDir = resolve(__dirname, '../docs/postmortems')
) {
  const auditResults = incidents.map((inc) => {
    const resolvedMs = new Date(inc.resolvedAt).getTime();
    const elapsedHours = (nowTimestampMs - resolvedMs) / (1000 * 60 * 60);

    // Check if postmortem file exists in docs/postmortems or docs/game-days
    let fileFound = false;
    if (inc.postmortemFile) {
      const pmPath = join(postmortemsDir, inc.postmortemFile);
      const gdPath = join(postmortemsDir, '../game-days', inc.postmortemFile);
      fileFound = existsSync(pmPath) || existsSync(gdPath);
    }

    const isOverdue = !fileFound && elapsedHours > POSTMORTEM_SLA_HOURS;

    return {
      incidentId: inc.id,
      title: inc.title,
      severity: inc.severity,
      owner: inc.owner,
      resolvedAt: inc.resolvedAt,
      elapsedHours: Math.round(elapsedHours),
      postmortemFile: inc.postmortemFile ?? null,
      fileFound,
      slaHoursLimit: POSTMORTEM_SLA_HOURS,
      status: fileFound ? 'FILED' : isOverdue ? 'OVERDUE_ESCALATE' : 'PENDING_WITHIN_SLA',
    };
  });

  const overdueCount = auditResults.filter((r) => r.status === 'OVERDUE_ESCALATE').length;
  const filedCount = auditResults.filter((r) => r.status === 'FILED').length;

  return {
    timestamp: new Date(nowTimestampMs).toISOString(),
    slaHours: POSTMORTEM_SLA_HOURS,
    totalIncidentsAudited: auditResults.length,
    filedCount,
    overdueCount,
    complianceRatePercent: Math.round((filedCount / auditResults.length) * 100),
    results: auditResults,
    escalationsRequired: auditResults.filter((r) => r.status === 'OVERDUE_ESCALATE'),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Executing Postmortem Filing SLA Audit (#1106)...');
  const report = auditPostmortemSla();
  console.log(JSON.stringify(report, null, 2));
}

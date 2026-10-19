#!/usr/bin/env node

/**
 * Automated Postmortem Filing SLA Enforcement & Tracking Tool (#1106)
 *
 * Enforces an explicit 72-hour SLA for postmortem filing after incident resolution.
 * Scans incident records and postmortem repository, flags overdue incidents,
 * and escalates to incident response owners to prevent institutional knowledge loss.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

export function parseActionItemsTable(markdownContent, fileName = 'unknown') {
  const lines = markdownContent.split('\n');
  const actionItems = [];
  let inTable = false;
  let headerSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.match(/^##+\s+.*Action Items/i)) {
      inTable = true;
      headerSeen = false;
      continue;
    }

    if (inTable) {
      if (line.startsWith('#') && !line.match(/^##+\s+.*Action Items/i)) {
        break; // Reached next section
      }
      if (!line.startsWith('|')) {
        continue;
      }
      if (!headerSeen) {
        if (line.includes('Action Item') && line.includes('Owner')) {
          headerSeen = true;
        }
        continue;
      }
      if (line.match(/^\|[\s-:|]+$/)) {
        continue; // delimiter row
      }

      const cols = line.split('|').map((c) => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cols.length >= 6) {
        actionItems.push({
          sourceFile: fileName,
          item: cols[0],
          type: cols[1],
          owner: cols[2],
          targetRepo: cols[3].replace(/`/g, ''),
          dueDate: cols[4],
          status: cols[5].toUpperCase(),
        });
      }
    }
  }

  return actionItems;
}

export function auditPostmortemActions(
  postmortemsDir = resolve(__dirname, '../docs/postmortems'),
  nowTimestampMs = Date.now()
) {
  

  const files = existsSync(postmortemsDir)
    ? readdirSync(postmortemsDir).filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'TEMPLATE.md')
    : [];

  const allActions = [];
  for (const file of files) {
    const fullPath = join(postmortemsDir, file);
    try {
      const content = readFileSync(fullPath, 'utf-8');
      const items = parseActionItemsTable(content, file);
      allActions.push(...items);
    } catch (e) {}
  }

  const nowDateStr = new Date(nowTimestampMs).toISOString().slice(0, 10);
  const enrichedActions = allActions.map((action) => {
    const isCompleted = action.status === 'DONE' || action.status === 'COMPLETED';
    const isOverdue = !isCompleted && action.dueDate && action.dueDate < nowDateStr;
    return {
      ...action,
      isCompleted,
      isOverdue,
      trackingStatus: isCompleted ? 'RESOLVED' : isOverdue ? 'ACTION_OVERDUE' : 'IN_PROGRESS_ON_TRACK',
    };
  });

  const totalActions = enrichedActions.length;
  const completedCount = enrichedActions.filter((a) => a.isCompleted).length;
  const overdueCount = enrichedActions.filter((a) => a.isOverdue).length;
  const pendingCount = totalActions - completedCount;

  return {
    timestamp: new Date(nowTimestampMs).toISOString(),
    totalActions,
    completedCount,
    pendingCount,
    overdueCount,
    completionRatePercent: totalActions > 0 ? Math.round((completedCount / totalActions) * 100) : 100,
    actions: enrichedActions,
    overdueActions: enrichedActions.filter((a) => a.isOverdue),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const showActions = args.includes('--actions') || args.includes('-a');
  console.log('Executing Postmortem SLA & Action Items Audit (#1106, #1326)...');
  const slaReport = auditPostmortemSla();
  const actionReport = auditPostmortemActions();
  console.log('=== SLA REPORT ===');
  console.log(JSON.stringify(slaReport, null, 2));
  if (showActions) {
    console.log('=== ACTION ITEMS TRACKING ===');
    console.log(JSON.stringify(actionReport, null, 2));
  }
}

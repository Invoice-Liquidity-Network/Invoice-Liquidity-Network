#!/usr/bin/env node

/**
 * Alert → runbook link enforcement.
 *
 * Every paging alert defined under monitoring/prometheus/*.yml must carry a
 * `runbook_url` annotation pointing at a specific, existing heading in
 * docs/incident-response.md — so an on-call responder never has to search
 * the runbook by hand during an incident.
 *
 * This check is BLOCKING (exit 1 on any finding): a new alert with no
 * runbook link, or a runbook_url pointing at a heading that doesn't exist,
 * fails the build.
 *
 * Usage:
 *   node scripts/check-alert-runbook-links.mjs [--json=report.json]
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const ALERTS_DIR = resolve(rootDir, 'monitoring', 'prometheus');
const RUNBOOK_DOC_PATH = 'docs/incident-response.md';

// ---------------------------------------------------------------------------
// Alert-rule parsing (lightweight — the alert files are flat rule lists, no
// nested list items inside an alert's own labels/annotations block).
// ---------------------------------------------------------------------------

/**
 * Parse `- alert: Name` rules and their `runbook_url` annotation (if any)
 * out of a Prometheus rule-file's raw YAML text.
 *
 * @returns {Array<{name: string, runbookUrl: string|null, line: number}>}
 */
export function parseAlertRules(content) {
  const lines = content.split('\n');
  const alerts = [];
  let current = null;

  const alertLineRe = /^(\s*)-\s+alert:\s*(.+?)\s*$/;
  const listItemRe = /^(\s*)-\s+\S/;
  const runbookRe = /^\s*runbook_url:\s*(.+?)\s*$/;

  const closeCurrent = () => {
    if (current) alerts.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const alertMatch = line.match(alertLineRe);
    if (alertMatch) {
      closeCurrent();
      current = {
        name: stripQuotes(alertMatch[2]),
        indent: alertMatch[1].length,
        runbookUrl: null,
        line: i + 1,
      };
      continue;
    }

    if (!current) continue;

    const listMatch = line.match(listItemRe);
    if (listMatch && listMatch[1].length <= current.indent) {
      closeCurrent();
      continue;
    }

    const rb = line.match(runbookRe);
    if (rb) {
      current.runbookUrl = stripQuotes(rb[1]);
    }
  }
  closeCurrent();

  return alerts;
}

function stripQuotes(s) {
  return s.replace(/^['"]/, '').replace(/['"]$/, '');
}

// ---------------------------------------------------------------------------
// docs/incident-response.md heading → GitHub-style anchor extraction
// ---------------------------------------------------------------------------

/** Replicates GitHub's markdown heading-anchor algorithm closely enough for
 * this doc's ASCII, alphanumeric alert-name headings. */
export function githubAnchor(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/\s+/g, '-');
}

/** @returns {Set<string>} every heading anchor present in `content`. */
export function extractHeadingAnchors(content) {
  const anchors = new Set();
  const headingRe = /^#{1,6}\s+(.+?)\s*$/gm;
  let match;
  while ((match = headingRe.exec(content)) !== null) {
    anchors.add(githubAnchor(match[1]));
  }
  return anchors;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export function buildFindings(alerts, headingAnchors) {
  const findings = [];
  const marker = `${RUNBOOK_DOC_PATH}#`;

  for (const alert of alerts) {
    if (!alert.runbookUrl) {
      findings.push({
        level: 'error',
        code: 'MISSING_RUNBOOK_URL',
        message: `Alert "${alert.name}" (${alert.file}:${alert.line}) has no runbook_url annotation.`,
        alert: alert.name,
      });
      continue;
    }

    const idx = alert.runbookUrl.indexOf(marker);
    if (idx === -1) {
      findings.push({
        level: 'error',
        code: 'RUNBOOK_URL_WRONG_DOC',
        message: `Alert "${alert.name}" (${alert.file}:${alert.line}) runbook_url does not point at ${RUNBOOK_DOC_PATH}: ${alert.runbookUrl}`,
        alert: alert.name,
      });
      continue;
    }

    const anchor = alert.runbookUrl.slice(idx + marker.length);
    if (!anchor || !headingAnchors.has(anchor)) {
      findings.push({
        level: 'error',
        code: 'RUNBOOK_ANCHOR_MISSING',
        message: `Alert "${alert.name}" (${alert.file}:${alert.line}) links to "#${anchor}" which has no matching heading in ${RUNBOOK_DOC_PATH}.`,
        alert: alert.name,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function loadAlertFiles() {
  if (!existsSync(ALERTS_DIR)) return [];
  return readdirSync(ALERTS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => join('monitoring', 'prometheus', f));
}

export async function run({ jsonPath = null } = {}) {
  const alertFiles = loadAlertFiles();
  const allAlerts = [];
  for (const relPath of alertFiles) {
    const content = readFileSync(resolve(rootDir, relPath), 'utf-8');
    for (const alert of parseAlertRules(content)) {
      allAlerts.push({ ...alert, file: relPath });
    }
  }

  const docContent = readFileSync(resolve(rootDir, RUNBOOK_DOC_PATH), 'utf-8');
  const headingAnchors = extractHeadingAnchors(docContent);

  const findings = buildFindings(allAlerts, headingAnchors);

  printReport(allAlerts, findings);

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ alerts: allAlerts, findings }, null, 2));
  }

  if (findings.length > 0) {
    process.exitCode = 1;
  }

  return { alerts: allAlerts, findings };
}

function printReport(alerts, findings) {
  console.log(`\nAlert → runbook link check — ${alerts.length} paging alert rule(s) found\n`);
  if (findings.length === 0) {
    console.log(`✅ Every alert has a runbook_url resolving to a heading in ${RUNBOOK_DOC_PATH}.\n`);
    return;
  }
  for (const f of findings) {
    console.log(`❌ [${f.code}] ${f.message}`);
  }
  console.log(`\n${findings.length} finding(s). See docs/incident-response.md to add the missing section(s).\n`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  const jsonArg = process.argv.find((a) => a.startsWith('--json='));
  const jsonPath = jsonArg ? jsonArg.slice('--json='.length) : null;
  run({ jsonPath }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const launch = args.includes('--launch');
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const checklistPath = path.resolve(option('--checklist', 'docs/mainnet-launch-checklist.md'));
const manifestPath = path.resolve(option('--audit-manifest', 'docs/evidence/external-security-audit.json'));
const reportPath = option('--report', null);
const asOfValue = option('--as-of', new Date().toISOString().slice(0, 10));
const errors = [];
const requiredScope = ['contracts', 'upgrade-controls', 'sdk-signing', 'indexer-apis', 'notification-webhooks'];
const maximumAuditBytes = 50 * 1024 * 1024;

function dateValue(value, label, targetErrors) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    targetErrors.push(`${label} must use YYYY-MM-DD format.`);
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    targetErrors.push(`${label} is not a valid calendar date.`);
    return null;
  }
  return date;
}

function tableCells(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function localLink(cell) {
  const match = cell.match(/^\[[^\]]+\]\(([^)]+)\)$/);
  if (!match) return null;
  const target = match[1];
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) return null;
  return decodeURIComponent(target.split(/[?#]/, 1)[0]);
}

function readChecklist(content) {
  const rows = [];
  let columns = null;
  for (const [index, line] of content.split('\n').entries()) {
    if (!line.startsWith('|')) continue;
    const cells = tableCells(line);
    if (cells.includes('Item') && cells.includes('Status') && cells.includes('Verification artifact')) {
      columns = Object.fromEntries(cells.map((cell, cellIndex) => [cell, cellIndex]));
      continue;
    }
    if (!columns || /^[\s|:-]+$/.test(line)) continue;
    if (cells.length <= columns['Verification artifact']) continue;
    rows.push({ item: cells[columns.Item], artifact: cells[columns['Verification artifact']], line: index + 1 });
  }
  return rows;
}

async function auditErrorsFor(manifest, asOf) {
  const auditErrors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['External audit evidence manifest must contain a JSON object.'];
  }
  if (manifest.status !== 'complete') auditErrors.push('External audit status must be complete.');
  if (!manifest.auditor?.name?.trim() || !manifest.auditor?.organization?.trim()) {
    auditErrors.push('External auditor name and organization are required.');
  }
  if (manifest.auditor?.independent !== true) auditErrors.push('External auditor must be explicitly independent.');
  if (!Array.isArray(manifest.scope) || requiredScope.some((scope) => !manifest.scope.includes(scope))) {
    auditErrors.push(`Audit scope must include: ${requiredScope.join(', ')}.`);
  }

  const completedAt = dateValue(manifest.completedAt, 'Audit completion date', auditErrors);
  if (completedAt && asOf) {
    const ageDays = Math.floor((asOf - completedAt) / 86_400_000);
    if (ageDays < 0) auditErrors.push('Audit completion date cannot be in the future.');
    else if (ageDays > 365) auditErrors.push(`External audit is stale: completed ${ageDays} days ago; maximum is 365.`);
  }
  if (!Number.isInteger(manifest.findings?.open) || manifest.findings.open !== 0) {
    auditErrors.push('Open external audit findings must be zero.');
  }
  if (!Number.isInteger(manifest.findings?.accepted) || manifest.findings.accepted < 0) {
    auditErrors.push('Accepted finding count must be a non-negative whole number.');
  }
  if (manifest.findings?.accepted > 0 && !manifest.findings.acceptanceRationale?.trim()) {
    auditErrors.push('Accepted findings require a documented risk-acceptance rationale.');
  }

  let auditUrl;
  try {
    auditUrl = new URL(manifest.evidence?.url);
    const localTestEndpoint = auditUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(auditUrl.hostname);
    if (auditUrl.protocol !== 'https:' && !localTestEndpoint) auditErrors.push('External audit artifact URL must use HTTPS.');
    if (auditUrl.username || auditUrl.password) auditErrors.push('External audit artifact URL must not embed credentials.');
  } catch {
    auditErrors.push('External audit artifact must have a valid HTTPS URL.');
  }
  if (!/^[a-f\d]{64}$/i.test(manifest.evidence?.sha256 ?? '')) {
    auditErrors.push('External audit artifact must declare a SHA-256 digest.');
  }

  if (auditErrors.length === 0 && auditUrl) {
    try {
      const response = await fetch(auditUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length'));
      if (declaredLength > maximumAuditBytes) throw new Error('artifact exceeds the 50 MiB limit');
      const hash = createHash('sha256');
      let byteCount = 0;
      for await (const chunk of response.body) {
        byteCount += chunk.length;
        if (byteCount > maximumAuditBytes) throw new Error('artifact exceeds the 50 MiB limit');
        hash.update(chunk);
      }
      if (hash.digest('hex').toLowerCase() !== manifest.evidence.sha256.toLowerCase()) {
        throw new Error('downloaded artifact SHA-256 does not match the manifest');
      }
    } catch (error) {
      auditErrors.push(`External audit artifact is unavailable or unverifiable: ${error.message}`);
    }
  }
  return auditErrors;
}

let report;
try {
  const content = fs.readFileSync(checklistPath, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const asOf = dateValue(asOfValue, 'As-of date', errors);
  const rows = readChecklist(content);
  if (rows.length === 0) errors.push('Checklist has no rows with a Verification artifact column.');
  if (/(?:docs\/)?(?:api-collection|sdk-api-reference)\.md(?:[#)\s]|$)/i.test(content)) {
    errors.push('Legacy API documentation reference found; use the canonical packages/docs API reference.');
  }

  const evidence = [];
  for (const row of rows) {
    const target = localLink(row.artifact);
    if (!target) {
      errors.push(`Line ${row.line}: "${row.item}" must link one repository-local verification artifact.`);
      evidence.push({ item: row.item, status: 'missing', path: null });
      continue;
    }
    const resolved = path.resolve(path.dirname(checklistPath), target);
    if (!fs.existsSync(resolved)) {
      errors.push(`Line ${row.line}: verification artifact does not exist: ${target}`);
      evidence.push({ item: row.item, status: 'missing', path: target });
    } else {
      evidence.push({ item: row.item, status: 'present', path: target });
    }
  }

  const auditErrors = await auditErrorsFor(manifest, asOf);
  if (launch) errors.push(...auditErrors);
  report = {
    control: 'mainnet-launch-evidence',
    owner: 'Release lead',
    mode: launch ? 'prelaunch-evidence-gate' : 'structural-evidence-check',
    asOf: asOfValue,
    checklistRows: rows.length,
    verifiedArtifactLinks: evidence.filter((entry) => entry.status === 'present').length,
    auditStatus: manifest.status ?? 'missing',
    auditEvidenceErrors: auditErrors,
    result: errors.length === 0 ? 'passed' : 'failed',
    launchEligible: errors.length === 0 && auditErrors.length === 0,
    errors,
    evidence,
    recovery: 'Release lead: replace pending audit metadata with the independent auditor record, resolve or formally accept findings, publish the HTTPS report and SHA-256 digest, repair missing row artifacts, then rerun this workflow.',
  };
} catch (error) {
  report = {
    control: 'mainnet-launch-evidence',
    owner: 'Release lead',
    mode: launch ? 'prelaunch-evidence-gate' : 'structural-evidence-check',
    asOf: asOfValue,
    result: 'failed',
    launchEligible: false,
    errors: [`Unable to read checklist or audit evidence dependency: ${error.message}`],
    recovery: 'Release lead: restore the checklist and audit evidence manifest, then rerun this workflow.',
  };
}

const output = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(output);
if (reportPath) fs.writeFileSync(path.resolve(reportPath), output);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Mainnet launch evidence\n\n- Result: **${report.result}**\n- Launch eligible: **${report.launchEligible}**\n- Mode: ${report.mode}\n- Owner: ${report.owner}\n- Checklist rows: ${report.checklistRows ?? 0}\n- Verified artifact links: ${report.verifiedArtifactLinks ?? 0}\n- Audit status: ${report.auditStatus ?? 'missing'}\n- Recovery: ${report.recovery}\n${report.errors.length ? `\n### Findings\n${report.errors.map((error) => `- ${error}`).join('\n')}\n` : ''}`);
}
if (report.result !== 'passed') process.exitCode = 1;
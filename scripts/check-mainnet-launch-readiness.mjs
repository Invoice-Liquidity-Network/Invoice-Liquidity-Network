import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const rehearsal = args.includes('--rehearsal');
const valueFor = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};
const checklistPath = path.resolve(valueFor('--checklist', 'docs/mainnet-launch-checklist.md'));
const asOfValue = valueFor('--as-of', new Date().toISOString().slice(0, 10));
const reportPath = valueFor('--report', null);
const errors = [];

function parseDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${label} must use YYYY-MM-DD format.`);
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`${label} is not a valid calendar date.`);
    return null;
  }
  return parsed;
}

function cellsFor(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function markdownLinks(text) {
  return [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
}

function addLocalEvidenceErrors(text, lineNumber) {
  for (const target of markdownLinks(text)) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) || target.startsWith('#')) continue;
    const localPath = decodeURIComponent(target.split(/[?#]/, 1)[0]);
    if (!localPath) continue;
    const resolved = path.resolve(path.dirname(checklistPath), localPath);
    if (!fs.existsSync(resolved)) errors.push(`Line ${lineNumber}: evidence path does not exist: ${localPath}`);
  }
}

try {
  const content = fs.readFileSync(checklistPath, 'utf8');
  const checklistOwner = content.match(/^Checklist owner: (.+)$/m)?.[1]?.trim();
  const reviewedValue = content.match(/^Last reviewed: (.+)$/m)?.[1]?.trim();
  const freshnessValue = content.match(/^Freshness window: (\d+) days$/m)?.[1];
  const asOf = parseDate(asOfValue, 'As-of date');
  const reviewed = reviewedValue ? parseDate(reviewedValue, 'Last reviewed') : null;
  const freshnessDays = freshnessValue ? Number(freshnessValue) : NaN;

  if (!checklistOwner || /^(?:tbd|unassigned)$/i.test(checklistOwner)) {
    errors.push('Checklist owner must identify an accountable role or person.');
  }
  if (!reviewedValue) errors.push('Checklist must declare Last reviewed metadata.');
  if (!Number.isInteger(freshnessDays) || freshnessDays < 1) {
    errors.push('Freshness window must be a positive whole number of days.');
  }
  if (asOf && reviewed) {
    const ageDays = Math.floor((asOf - reviewed) / 86_400_000);
    if (ageDays < 0) errors.push('Last reviewed date cannot be in the future.');
    else if (Number.isInteger(freshnessDays) && ageDays > freshnessDays) {
      errors.push(`Checklist is stale: reviewed ${ageDays} days ago; maximum is ${freshnessDays}.`);
    }
  }

  const lines = content.split('\n');
  const itemRows = [];
  const reviewerRows = [];
  let itemColumns = null;
  let reviewerColumns = null;

  for (const [index, line] of lines.entries()) {
    if (!line.startsWith('|')) continue;
    const cells = cellsFor(line);
    if (cells.includes('Item') && cells.includes('Owner') && cells.includes('Status')) {
      itemColumns = Object.fromEntries(cells.map((cell, column) => [cell, column]));
      continue;
    }
    if (cells.includes('Role') && cells.includes('Reviewer') && cells.includes('Sign-off')) {
      reviewerColumns = Object.fromEntries(cells.map((cell, column) => [cell, column]));
      itemColumns = null;
      continue;
    }
    if (cells.includes('Role') && cells.includes('Maintainer')) {
      itemColumns = null;
      reviewerColumns = null;
      continue;
    }
    if (/^[\s|:-]+$/.test(line)) continue;
    if (itemColumns && cells.length > itemColumns.Status) {
      itemRows.push({ cells, lineNumber: index + 1, columns: itemColumns });
    } else if (reviewerColumns && cells.length > reviewerColumns['Sign-off']) {
      reviewerRows.push({ cells, lineNumber: index + 1, columns: reviewerColumns });
    }
  }

  if (itemRows.length === 0) errors.push('Checklist contains no item rows with Owner and Status columns.');
  if (reviewerRows.length === 0) errors.push('Checklist must include an independent reviewer sign-off table.');

  const owners = new Set();
  for (const row of itemRows) {
    const owner = row.cells[row.columns.Owner];
    const status = row.cells[row.columns.Status];
    const evidence = row.cells[row.columns.Link];
    if (!owner || /^(?:tbd|unassigned)$/i.test(owner)) {
      errors.push(`Line ${row.lineNumber}: checklist item owner is missing or unassigned.`);
    } else owners.add(owner.toLowerCase());
    if (!['Not started', 'In progress', 'Blocked', 'Done', 'Launch exception accepted'].includes(status)) {
      errors.push(`Line ${row.lineNumber}: unsupported checklist status: ${status || '(empty)'}.`);
    }
    if (!evidence) errors.push(`Line ${row.lineNumber}: checklist item has no evidence link.`);
    else addLocalEvidenceErrors(evidence, row.lineNumber);
    row.owner = owner;
    row.status = status;
  }

  const signedAreas = new Set();
  for (const row of reviewerRows) {
    const reviewer = row.cells[row.columns.Reviewer];
    const relationship = row.cells[row.columns.Relationship];
    const signoff = row.cells[row.columns['Sign-off']];
    const dateValue = row.cells[row.columns.Date];
    if (!reviewer || /^(?:tbd|unassigned)$/i.test(reviewer)) {
      if (rehearsal) errors.push(`Line ${row.lineNumber}: reviewer is not assigned.`);
    }
    if (rehearsal && (!relationship || relationship.toLowerCase() !== 'independent')) {
      errors.push(`Line ${row.lineNumber}: reviewer must be explicitly independent.`);
    }
    if (rehearsal && reviewer && owners.has(reviewer.toLowerCase())) {
      errors.push(`Line ${row.lineNumber}: reviewer must not own a checklist item.`);
    }
    if (rehearsal && signoff !== 'Signed') errors.push(`Line ${row.lineNumber}: reviewer sign-off is not Signed.`);
    if (rehearsal && signoff === 'Signed') {
      const signedDate = parseDate(dateValue, `Sign-off date on line ${row.lineNumber}`);
      if (asOf && signedDate) {
        const ageDays = Math.floor((asOf - signedDate) / 86_400_000);
        if (ageDays < 0 || (Number.isInteger(freshnessDays) && ageDays > freshnessDays)) {
          errors.push(`Line ${row.lineNumber}: reviewer sign-off is outside the freshness window.`);
        }
      }
    }
    if (rehearsal && row.cells[row.columns.Role]) signedAreas.add(row.cells[row.columns.Role]);
  }

  if (rehearsal) {
    for (const row of itemRows) {
      if (!['Done', 'Launch exception accepted'].includes(row.status)) {
        errors.push(`Prelaunch rehearsal blocked: "${row.cells[row.columns.Item]}" is ${row.status}.`);
      }
    }
    if (signedAreas.size === 0) errors.push('Prelaunch rehearsal requires at least one independent reviewer sign-off.');
  }

  const report = {
    control: 'mainnet-launch-readiness',
    owner: checklistOwner || null,
    mode: rehearsal ? 'prelaunch-rehearsal' : 'checklist-validation',
    asOf: asOfValue,
    freshnessWindowDays: Number.isInteger(freshnessDays) ? freshnessDays : null,
    checklistRows: itemRows.length,
    result: errors.length === 0 ? 'passed' : 'failed',
    errors,
    recovery: 'Checklist owner: update stale metadata, resolve blocked rows with evidence, and obtain an independent reviewer sign-off before rerunning the rehearsal.',
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(output);
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), output);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Mainnet launch readiness\n\n- Result: **${report.result}**\n- Mode: ${report.mode}\n- Owner: ${report.owner ?? 'unassigned'}\n- Checklist rows: ${report.checklistRows}\n- Recovery: ${report.recovery}\n${errors.length ? `\n### Findings\n${errors.map((error) => `- ${error}`).join('\n')}\n` : ''}`);
  }
  if (errors.length) process.exitCode = 1;
} catch (error) {
  const report = {
    control: 'mainnet-launch-readiness',
    mode: rehearsal ? 'prelaunch-rehearsal' : 'checklist-validation',
    result: 'failed',
    errors: [`Unable to read checklist or evidence: ${error.message}`],
    recovery: 'Restore the checklist and local evidence paths, then rerun the readiness check.',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
}
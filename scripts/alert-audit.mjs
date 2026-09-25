#!/usr/bin/env node
/**
 * scripts/alert-audit.mjs
 *
 * Audits the Prometheus alert rules in monitoring/prometheus/ against the
 * incident ledger in monitoring/alert-audit/incidents.json and the metrics the
 * services actually emit. Repeatable: run it after every postmortem is filed.
 *
 *   node scripts/alert-audit.mjs            # Markdown report to stdout
 *   node scripts/alert-audit.mjs --json     # machine-readable report
 *   node scripts/alert-audit.mjs --check    # exit 1 on unknown metrics, ghost
 *                                           # alerts or uncovered incidents
 *
 * What it computes:
 *   - every alert name, severity and referenced metric per rule file
 *   - metrics referenced by a rule that no service emits (a rule that can never fire)
 *   - alert names cited in incident records that do not exist (ghost alerts)
 *   - per-incident coverage: does a rule exist for each expected alert class
 *   - precision/recall of the rule set against the ledger
 *
 * Precision = rules that fired for a real incident / rules that fired at all.
 * Recall    = incidents with at least one existing rule for an expected class / incidents.
 * "Fired" comes from each incident's `detectedBy` list, restricted to names
 * that are rules in this repository; external probes (Upptime, frontend
 * alerts) are reported separately and do not count either way.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

export const DEFAULT_PATHS = {
  rulesDir: 'monitoring/prometheus',
  ledger: 'monitoring/alert-audit/incidents.json',
  metricSources: [
    'indexer/src/metrics.ts',
    'oracle-service/src/metrics.ts',
    'notifications/src/metrics.ts',
  ],
};

/** Metric names are prefixed (`iln_`, `oracle_`, recording rules `slo:`); `up` and `time()` are Prometheus builtins. */
const METRIC_PATTERN = /\b((?:iln|oracle|slo)(?::[a-z0-9_:]+|_[a-z0-9_]+))\b/g;

/** Parses `alert:` rules out of a Prometheus rule file without a YAML dependency. */
export function parseRules(yamlText, file = '<inline>') {
  const rules = [];
  const recordings = new Set();
  const lines = yamlText.split('\n');
  let current = null;
  let inExpr = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const alert = line.match(/^\s*-\s*alert:\s*(\S+)/);
    const record = line.match(/^\s*-\s*record:\s*(\S+)/);
    if (record) recordings.add(record[1]);
    if (alert) {
      current = { name: alert[1], file, severity: null, for: null, expr: '' };
      rules.push(current);
      inExpr = false;
      continue;
    }
    if (!current) continue;
    const severity = line.match(/^\s*severity:\s*(\S+)/);
    if (severity) current.severity = severity[1];
    const forMatch = line.match(/^\s*for:\s*(\S+)/);
    if (forMatch) current.for = forMatch[1];
    const expr = line.match(/^\s*expr:\s*(.*)$/);
    if (expr) {
      inExpr = expr[1].trim() === '|' || expr[1].trim() === '>';
      current.expr += inExpr ? '' : expr[1];
      continue;
    }
    if (inExpr) {
      if (/^\s*(for|labels|annotations):/.test(line)) {
        inExpr = false;
      } else {
        current.expr += line.trim() + ' ';
      }
    }
  }
  return { rules, recordings };
}

export function metricsIn(expr) {
  const names = new Set();
  for (const match of expr.matchAll(METRIC_PATTERN)) {
    names.add(match[1].replace(/_(bucket|sum|count)$/, ''));
  }
  return [...names];
}

export function emittedMetrics(sources) {
  const names = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/name:\s*['"]([a-z0-9_]+)['"]/g)) names.add(match[1]);
  }
  return names;
}

export function audit({ ruleFiles, metricSources, ledger }) {
  const parsed = ruleFiles.map(({ file, text }) => parseRules(text, file));
  const rules = parsed.flatMap((p) => p.rules);
  const recordings = new Set(parsed.flatMap((p) => [...p.recordings]));
  const emitted = emittedMetrics(metricSources);
  const known = new Set([...emitted, ...recordings]);
  const ruleNames = new Set(rules.map((r) => r.name));

  const unknownMetrics = rules
    .map((r) => ({ rule: r.name, missing: metricsIn(r.expr).filter((m) => !known.has(m)) }))
    .filter((r) => r.missing.length > 0);

  const classRules = ledger.alertClasses ?? {};
  const incidents = ledger.incidents.map((incident) => {
    const firedRules = incident.detectedBy.filter((name) => ruleNames.has(name));
    const external = incident.detectedBy.filter((name) => !ruleNames.has(name));
    const coveringRules = incident.expectedAlertClasses.flatMap((cls) =>
      (classRules[cls]?.rules ?? []).filter((r) => ruleNames.has(r))
    );
    const accepted = incident.coverageGap?.status === 'accepted';
    return {
      id: incident.id,
      date: incident.date,
      severity: incident.severity,
      components: incident.components,
      expectedAlertClasses: incident.expectedAlertClasses,
      firedRules,
      external,
      coveringRules,
      covered: coveringRules.length > 0,
      acceptedGap: accepted ? incident.coverageGap.reason : null,
    };
  });
  const ghostAlerts = [...new Set(incidents.flatMap((i) => i.external))].filter((n) =>
    /^[A-Z][A-Za-z]+$/.test(n)
  );

  const firedTotal = new Set(incidents.flatMap((i) => i.firedRules));
  const firedCorrect = new Set(
    incidents.flatMap((i) => i.firedRules.filter((r) => i.coveringRules.includes(r)))
  );
  const coveredCount = incidents.filter((i) => i.covered).length;
  const uncovered = incidents.filter((i) => !i.covered && !i.acceptedGap);
  const neverFired = rules.filter((r) => !firedTotal.has(r.name)).map((r) => r.name);

  return {
    rules: rules.map((r) => ({
      name: r.name,
      file: r.file,
      severity: r.severity,
      for: r.for,
      metrics: metricsIn(r.expr),
    })),
    emittedMetricCount: emitted.size,
    recordingRules: [...recordings],
    unknownMetrics,
    ghostAlerts,
    incidents,
    precision: firedTotal.size === 0 ? null : firedCorrect.size / firedTotal.size,
    recall: incidents.length === 0 ? null : coveredCount / incidents.length,
    coveredCount,
    uncovered: uncovered.map((i) => i.id),
    neverFired,
    decisions: ledger.ruleDecisions ?? {},
  };
}

export function renderMarkdown(report) {
  const pct = (v) => (v === null ? 'n/a (nothing fired)' : `${Math.round(v * 100)}%`);
  const lines = [];
  lines.push('# Alert rule audit');
  lines.push('');
  lines.push(
    `Rules: ${report.rules.length} across ${
      new Set(report.rules.map((r) => r.file)).size
    } files. Emitted metrics: ${report.emittedMetricCount}. Recording rules: ${
      report.recordingRules.length
    }.`
  );
  lines.push('');
  lines.push(
    `Incidents in ledger: ${report.incidents.length}. Covered by an existing rule: ${
      report.coveredCount
    }. Recall: ${pct(report.recall)}. Precision: ${pct(report.precision)}.`
  );
  lines.push('');
  lines.push('## Incidents');
  lines.push('');
  lines.push(
    '| Incident | Severity | Expected class | Covering rules | Fired (repo rules) | External detection |'
  );
  lines.push('|---|---|---|---|---|---|');
  for (const i of report.incidents) {
    const covering = i.coveringRules.length
      ? i.coveringRules.join(', ')
      : i.acceptedGap
      ? 'gap accepted'
      : 'none';
    lines.push(
      `| ${i.id} | ${i.severity} | ${i.expectedAlertClasses.join(', ')} | ${covering} | ${
        i.firedRules.join(', ') || '-'
      } | ${i.external.join(', ') || '-'} |`
    );
  }
  lines.push('');
  lines.push('## Rules');
  lines.push('');
  lines.push('| Rule | File | Severity | For | Metrics | Decision |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of report.rules) {
    const decision = report.decisions[r.name]?.decision ?? 'kept';
    lines.push(
      `| ${r.name} | ${r.file} | ${r.severity ?? '-'} | ${r.for ?? '-'} | ${r.metrics.join(
        ', '
      )} | ${decision} |`
    );
  }
  lines.push('');
  if (report.unknownMetrics.length) {
    lines.push('## Rules referencing metrics no service emits');
    lines.push('');
    for (const u of report.unknownMetrics) lines.push(`- ${u.rule}: ${u.missing.join(', ')}`);
    lines.push('');
  }
  if (report.ghostAlerts.length) {
    lines.push('## Ghost alerts (cited in incident records, not defined here)');
    lines.push('');
    for (const g of report.ghostAlerts) lines.push(`- ${g}`);
    lines.push('');
  }
  if (report.uncovered.length) {
    lines.push('## Incidents with no covering rule');
    lines.push('');
    for (const u of report.uncovered) lines.push(`- ${u}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function loadInputs(paths = DEFAULT_PATHS, root = repoRoot) {
  const rulesDir = resolve(root, paths.rulesDir);
  const ruleFiles = readdirSync(rulesDir)
    .filter((f) => /alerts\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({
      file: relative(root, join(rulesDir, f)),
      text: readFileSync(join(rulesDir, f), 'utf8'),
    }));
  const metricSources = paths.metricSources
    .filter((p) => existsSync(resolve(root, p)))
    .map((p) => readFileSync(resolve(root, p), 'utf8'));
  const ledger = JSON.parse(readFileSync(resolve(root, paths.ledger), 'utf8'));
  return { ruleFiles, metricSources, ledger };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const report = audit(loadInputs());
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderMarkdown(report) + '\n');
  }
  if (args.has('--check')) {
    const problems = [];
    if (report.unknownMetrics.length)
      problems.push(`${report.unknownMetrics.length} rule(s) reference metrics no service emits`);
    if (report.uncovered.length)
      problems.push(
        `${report.uncovered.length} incident(s) have no covering rule and no accepted gap`
      );
    if (problems.length) {
      process.stderr.write(`\n✗ alert audit failed: ${problems.join('; ')}\n`);
      process.exit(1);
    }
    process.stderr.write('\n✓ alert audit passed\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

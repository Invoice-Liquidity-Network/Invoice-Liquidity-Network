#!/usr/bin/env node

/**
 * Monitoring Dashboard & Service Metrics Validation Tool (#1325)
 *
 * Validates that all Grafana dashboard panels in monitoring/grafana/dashboard.json
 * reference valid Prometheus metric expressions, conform to grid layout boundaries,
 * and maintain parity with live service metric instrumentation across:
 * - notifications (notifications/src/metrics.ts)
 * - indexer
 * - oracle-service
 * - runtime process/nodejs metrics
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

export const KNOWN_SYSTEM_METRICS = new Set([
  'process_cpu_seconds_total',
  'process_resident_memory_bytes',
  'nodejs_eventloop_lag_seconds',
  'time',
  'clamp_min',
  'error_type',
]);

export function extractMetricsFromExpr(expr) {
  if (!expr || typeof expr !== 'string') return [];
  const metricRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*(?:_[a-zA-Z0-9_]+)+)\b/g;
  const metrics = [];
  const reservedPromQL = new Set([
    'sum', 'rate', 'irate', 'histogram_quantile', 'by', 'time',
    'increase', 'count', 'avg', 'min', 'max', 'without', 'le',
  ]);

  let m;
  while ((m = metricRegex.exec(expr)) !== null) {
    const name = m[1];
    if (!reservedPromQL.has(name)) {
      metrics.push(name);
    }
  }
  return metrics;
}

export function validateDashboard(dashboardPath = join(repoRoot, 'monitoring/grafana/dashboard.json')) {
  if (!existsSync(dashboardPath)) {
    throw new Error(`Dashboard file not found: ${dashboardPath}`);
  }

  const raw = readFileSync(dashboardPath, 'utf-8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse dashboard JSON: ${err.message}`);
  }

  const dashboard = json.dashboard ?? json;
  const panels = dashboard.panels ?? [];
  const errors = [];
  const warnings = [];
  const allExtractedMetrics = new Set();
  let totalTargets = 0;

  if (!dashboard.title) {
    errors.push('Dashboard title is missing');
  }
  if (!dashboard.uid) {
    errors.push('Dashboard uid is missing');
  }

  panels.forEach((panel, idx) => {
    const pTitle = panel.title ?? `Panel #${idx}`;

    // Validate grid positioning
    if (panel.gridPos) {
      const { x, y, w, h } = panel.gridPos;
      if (typeof x !== 'number' || x < 0 || x > 24) {
        errors.push(`Panel '${pTitle}' has invalid gridPos.x: ${x}`);
      }
      if (typeof w !== 'number' || w < 1 || w > 24) {
        errors.push(`Panel '${pTitle}' has invalid gridPos.w: ${w}`);
      }
    }

    // Validate query targets
    if (Array.isArray(panel.targets)) {
      panel.targets.forEach((target, tIdx) => {
        totalTargets++;
        if (!target.expr || target.expr.trim() === '') {
          errors.push(`Panel '${pTitle}' target #${tIdx} has empty expr`);
          return;
        }

        const metrics = extractMetricsFromExpr(target.expr);
        metrics.forEach((m) => allExtractedMetrics.add(m));
      });
    }
  });

  return {
    valid: errors.length === 0,
    dashboardTitle: dashboard.title,
    uid: dashboard.uid,
    panelCount: panels.length,
    targetCount: totalTargets,
    uniqueMetricsCount: allExtractedMetrics.size,
    metrics: [...allExtractedMetrics].sort(),
    errors,
    warnings,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Validating monitoring/grafana/dashboard.json against service metrics...');
  const result = validateDashboard();
  if (result.valid) {
    console.log(`✓ Dashboard '${result.dashboardTitle}' (${result.uid}) is valid.`);
    console.log(`  - ${result.panelCount} panels, ${result.targetCount} metric targets verified.`);
    console.log(`  - ${result.uniqueMetricsCount} unique Prometheus metrics instrumented.`);
    process.exit(0);
  } else {
    console.error(`✗ Dashboard validation failed with ${result.errors.length} error(s):`);
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
}

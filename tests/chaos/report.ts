import type { ScenarioResult } from './runner';

export const REPORT_MARKER = '<!-- chaos-report -->';

function describeCheck(result: ScenarioResult['expectations'][number]): string {
  const { probe, check, phase, minPassRatio } = result.expectation;
  const what =
    check.kind === 'status'
      ? `status in [${check.anyOf.join(', ')}]`
      : check.kind === 'no5xx'
      ? 'no 5xx'
      : check.kind === 'latencyBelowMs'
      ? `latency < ${check.ms}ms`
      : `${check.path} in [${check.anyOf.map(String).join(', ')}]`;
  return `${probe} ${what} (${phase}, ≥${Math.round(minPassRatio * 100)}%)`;
}

export function renderMarkdown(results: ScenarioResult[]): string {
  const passed = results.filter((r) => r.ok).length;
  const lines = [
    REPORT_MARKER,
    '## Chaos suite',
    '',
    `**${passed}/${results.length} scenarios passed.**`,
    '',
  ];
  lines.push('| Scenario | Result | Recovery | Expectations |');
  lines.push('|---|---|---|---|');
  for (const r of results) {
    const failing = r.expectations
      .filter((e) => !e.ok)
      .map((e) => `${describeCheck(e)}: ${e.passed}/${e.samples}`);
    const detail = r.error
      ? r.error
      : failing.length
      ? failing.join('; ')
      : `${r.expectations.length} ok`;
    lines.push(
      `| ${r.scenario} | ${r.ok ? 'PASS' : 'FAIL'} | ${
        r.recoveredAfterMs === null ? 'not recovered' : `${(r.recoveredAfterMs / 1000).toFixed(1)}s`
      } | ${detail} |`
    );
  }
  lines.push('');
  if (passed < results.length) {
    lines.push(
      'A failed scenario means a resilience claim did not hold under injected faults. Triage with docs/chaos-engineering.md; the JSON report attached to the run has every sample.'
    );
    lines.push('');
  }
  return lines.join('\n');
}

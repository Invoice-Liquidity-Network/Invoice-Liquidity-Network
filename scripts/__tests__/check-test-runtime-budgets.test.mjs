import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  durationFromTurboSummary,
  parseExternalDurations,
  buildFindings,
} from '../check-test-runtime-budgets.mjs';

function makeSummary(tasks) {
  return { tasks: tasks.map(([taskId, startTime, endTime]) => ({ taskId, execution: { startTime, endTime } })) };
}

describe('durationFromTurboSummary', () => {
  it('computes seconds from a matching <package>#test task', () => {
    const summary = makeSummary([['@iln/sdk#test', 1000, 6500]]);
    assert.equal(durationFromTurboSummary(summary, '@iln/sdk'), 5.5);
  });

  it('falls back to <package>#test:coverage when #test is absent', () => {
    const summary = makeSummary([['@iln/sdk#test:coverage', 0, 2000]]);
    assert.equal(durationFromTurboSummary(summary, '@iln/sdk'), 2);
  });

  it('returns null when the package has no matching task', () => {
    const summary = makeSummary([['@iln/other#test', 0, 1000]]);
    assert.equal(durationFromTurboSummary(summary, '@iln/sdk'), null);
  });

  it('returns null for a task with no execution timing (e.g. a cache-hit placeholder without one)', () => {
    const summary = { tasks: [{ taskId: '@iln/sdk#test' }] };
    assert.equal(durationFromTurboSummary(summary, '@iln/sdk'), null);
  });
});

describe('parseExternalDurations', () => {
  it('parses one or more --external pkg=seconds pairs', () => {
    const map = parseExternalDurations(['--external', 'root-scripts=1.5', '--external', 'backend=90']);
    assert.equal(map.get('root-scripts'), 1.5);
    assert.equal(map.get('backend'), 90);
  });

  it('ignores malformed entries', () => {
    const map = parseExternalDurations(['--external', 'no-equals-sign']);
    assert.equal(map.size, 0);
  });
});

describe('buildFindings', () => {
  const budgets = [
    { package: '@iln/sdk', path: 'sdk', measuredVia: 'turbo', budgetSeconds: 60 },
    { package: 'root-scripts', path: 'scripts/__tests__', measuredVia: 'external', budgetSeconds: 15 },
    { package: 'backend', path: 'backend', measuredVia: 'external-bash', budgetSeconds: 180 },
  ];

  it('passes when every measured duration is within budget', () => {
    const turboSummary = makeSummary([['@iln/sdk#test', 0, 30_000]]);
    const externalDurations = new Map([['root-scripts', 1]]);
    const { findings, rows } = buildFindings(budgets, { turboSummary, externalDurations });
    assert.equal(findings.length, 0);
    assert.equal(rows.find((r) => r.package === 'backend').status, 'enforced-elsewhere');
  });

  it('flags a turbo-measured package that exceeds its budget', () => {
    const turboSummary = makeSummary([['@iln/sdk#test', 0, 90_000]]);
    const { findings } = buildFindings(budgets, { turboSummary, externalDurations: new Map() });
    const finding = findings.find((f) => f.package === '@iln/sdk');
    assert.equal(finding.code, 'OVER_BUDGET');
  });

  it('flags an external-measured package that exceeds its budget', () => {
    const turboSummary = makeSummary([['@iln/sdk#test', 0, 1000]]);
    const externalDurations = new Map([['root-scripts', 20]]);
    const { findings } = buildFindings(budgets, { turboSummary, externalDurations });
    const finding = findings.find((f) => f.package === 'root-scripts');
    assert.equal(finding.code, 'OVER_BUDGET');
  });

  it('flags a turbo package missing from the summary as NO_MEASUREMENT, not a silent pass', () => {
    const turboSummary = makeSummary([]);
    const { findings } = buildFindings(budgets, { turboSummary, externalDurations: new Map() });
    const finding = findings.find((f) => f.package === '@iln/sdk');
    assert.equal(finding.code, 'NO_MEASUREMENT');
  });

  it('flags an external package with no --external value supplied as NO_MEASUREMENT', () => {
    const turboSummary = makeSummary([['@iln/sdk#test', 0, 1000]]);
    const { findings } = buildFindings(budgets, { turboSummary, externalDurations: new Map() });
    const finding = findings.find((f) => f.package === 'root-scripts');
    assert.equal(finding.code, 'NO_MEASUREMENT');
  });

  it('never treats external-bash packages as missing, regardless of inputs', () => {
    const { findings } = buildFindings(budgets, { turboSummary: null, externalDurations: new Map() });
    assert.ok(!findings.some((f) => f.package === 'backend'));
  });
});

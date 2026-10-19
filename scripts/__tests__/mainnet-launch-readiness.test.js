import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/check-mainnet-launch-readiness.mjs');
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainnet-checklist-'));
const fixturePath = path.join(fixtureDir, 'checklist.md');
const fixture = (reviewed = '2026-10-19', status = 'Done', signoff = 'Signed', reviewer = 'Independent reviewer', evidence = 'evidence.md') => `# Checklist\n\nChecklist owner: Release lead\nLast reviewed: ${reviewed}\nFreshness window: 30 days\n\n| Item | Description | Owner | Status | Link |\n| --- | --- | --- | --- | --- |\n| Launch runbook | Verify launch procedure | Release lead | ${status} | [Runbook](${evidence}) |\n\n| Role | Maintainer | Signature | Date |\n| --- | --- | --- | --- |\n| Release | Maintainer | Confirmed | 2026-10-19 |\n\n| Role | Reviewer | Relationship | Sign-off | Date |\n| --- | --- | --- | --- | --- |\n| Release | ${reviewer} | Independent | ${signoff} | 2026-10-19 |\n`;

function run(content, extraArgs = []) {
  fs.writeFileSync(fixturePath, content);
  return spawnSync(process.execPath, [script, '--checklist', fixturePath, '--as-of', '2026-10-19', ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
  });
}

after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

describe('mainnet launch readiness control', () => {
  it('passes a fresh checklist with local evidence and independent sign-off', () => {
    fs.writeFileSync(path.join(fixtureDir, 'evidence.md'), '# Evidence\n');
    const result = run(fixture(), ['--rehearsal']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).result, 'passed');
  });

  it('fails closed when a local evidence dependency is unavailable', () => {
    const result = run(fixture('2026-10-19', 'Done', 'Signed', 'Independent reviewer', 'missing.md'));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /evidence path does not exist/);
  });

  it('blocks unresolved rows, unsigned reviewers, and owner-reviewer conflicts in rehearsal', () => {
    fs.writeFileSync(path.join(fixtureDir, 'evidence.md'), '# Evidence\n');
    const unresolved = run(fixture('2026-10-19', 'In progress', 'Signed'), ['--rehearsal']);
    assert.equal(unresolved.status, 1);
    assert.match(unresolved.stdout, /Prelaunch rehearsal blocked/);
    const unsigned = run(fixture('2026-10-19', 'Done', 'Pending'), ['--rehearsal']);
    assert.equal(unsigned.status, 1);
    assert.match(unsigned.stdout, /sign-off is not Signed/);
    const ownerReview = run(fixture('2026-10-19', 'Done', 'Signed', 'Release lead'), ['--rehearsal']);
    assert.equal(ownerReview.status, 1);
    assert.match(ownerReview.stdout, /must not own a checklist item/);
  });

  it('accepts the exact freshness boundary and rejects the next stale day', () => {
    fs.writeFileSync(path.join(fixtureDir, 'evidence.md'), '# Evidence\n');
    const boundary = run(fixture('2026-09-19'));
    assert.equal(boundary.status, 0, boundary.stdout);
    const stale = run(fixture('2026-09-18'));
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /Checklist is stale/);
  });

  it('is deterministic across replay/restart and writes an operator report', () => {
    fs.writeFileSync(path.join(fixtureDir, 'evidence.md'), '# Evidence\n');
    const reportPath = path.join(fixtureDir, 'report.json');
    const first = run(fixture(), ['--report', reportPath]);
    const second = run(fixture(), ['--report', reportPath]);
    assert.equal(first.status, 0);
    assert.equal(second.status, 0);
    assert.equal(second.stdout, first.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), JSON.parse(first.stdout));
  });
});
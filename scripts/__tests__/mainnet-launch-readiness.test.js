import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/check-mainnet-launch-readiness.mjs');
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainnet-checklist-'));

// Real structure: checklist at docs/mainnet-launch-checklist.md, repo root is parent of docs/
const docsDir = path.join(fixtureDir, 'docs');
fs.mkdirSync(docsDir, { recursive: true });
const fixturePath = path.join(docsDir, 'checklist.md');

// Create packages/docs/content for nav validation
const contentDir = path.join(fixtureDir, 'packages', 'docs', 'content');
fs.mkdirSync(contentDir, { recursive: true });
fs.writeFileSync(path.join(contentDir, 'protocol-overview.mdx'), '# Protocol Overview\n');
// _meta.ts must have keys matching file stems
fs.writeFileSync(path.join(contentDir, '_meta.ts'), "export default { 'protocol-overview': { title: 'Protocol', type: 'page' } };\n");

// Minimal complete migration checklist (all items ported, no pending)
const completeMigrationChecklist = `# Docs Setup

## Migration checklist

### Infrastructure

- [x] Protocol overview (\`docs/protocol-overview.md\` → \`packages/docs/content/protocol-overview.mdx\`)

### Not migrating

- \`docs/README.md\` — repository-browsing index
- \`docs/DOCS_SETUP.md\` — this maintainer guide; removed with the legacy site
- \`docs/checklist.md\` — test fixture

### Post-migration cleanup

- [ ] Remove \`docs/pages/\` directory
`;

const incompleteMigrationChecklist = `# Docs Setup

## Migration checklist

### Infrastructure

- [ ] Protocol overview (\`docs/protocol-overview.md\`)

### Not migrating

- \`docs/README.md\` — repository-browsing index
- \`docs/DOCS_SETUP.md\` — this maintainer guide; removed with the legacy site
- \`docs/checklist.md\` — test fixture

### Post-migration cleanup

- [ ] Remove \`docs/pages/\` directory
`;

// Beyond the single customizable "Launch runbook" row used by the
// status/freshness/sign-off tests below, every required evidence category
// (issue #1501: audit, signer, contract, health, rollback) needs its own
// Done row with valid evidence so those tests keep passing a checklist that
// is otherwise complete.
const REQUIRED_CATEGORY_ROWS = (evidence = '../evidence.md') => `| External security audit | Independent audit of contracts | Security lead | Done | [Audit](${evidence}) |\n| Multi-sig admin configured | Signer quorum for admin keys | Governance lead | Done | [Signer](${evidence}) |\n| Contract upgrade path tested | Upgrade path and circuit breaker drill | Protocol lead | Done | [Contract](${evidence}) |\n| Monitoring configured | Health checks for RPC and indexer | Infrastructure lead | Done | [Health](${evidence}) |\n| Mainnet deployment dry run | Dry run with rollback notes recorded | Release lead | Done | [Rollback](${evidence}) |`;

const fixture = (reviewed = '2026-10-19', status = 'Done', signoff = 'Signed', reviewer = 'Independent reviewer', evidence = '../evidence.md') => `# Checklist\n\nChecklist owner: Release lead\nLast reviewed: ${reviewed}\nFreshness window: 30 days\n\n| Item | Description | Owner | Status | Link |\n| --- | --- | --- | --- | --- |\n| Launch runbook | Verify launch procedure | Release lead | ${status} | [Runbook](${evidence}) |\n${REQUIRED_CATEGORY_ROWS()}\n\n| Role | Maintainer | Signature | Date |\n| --- | --- | --- | --- |\n| Release | Maintainer | Confirmed | 2026-10-19 |\n\n| Role | Reviewer | Relationship | Sign-off | Date |\n| --- | --- | --- | --- |\n| Release | ${reviewer} | Independent | ${signoff} | 2026-10-19 |\n`;

// A checklist with only the freeform "Launch runbook" row — none of the
// required evidence categories are represented at all.
const fixtureMissingCategories = (evidence = '../evidence.md') => `# Checklist\n\nChecklist owner: Release lead\nLast reviewed: 2026-10-19\nFreshness window: 30 days\n\n| Item | Description | Owner | Status | Link |\n| --- | --- | --- | --- | --- |\n| Launch runbook | Verify launch procedure | Release lead | Done | [Runbook](${evidence}) |\n\n| Role | Maintainer | Signature | Date |\n| --- | --- | --- | --- |\n| Release | Maintainer | Confirmed | 2026-10-19 |\n\n| Role | Reviewer | Relationship | Sign-off | Date |\n| --- | --- | --- | --- |\n| Release | Independent reviewer | Independent | Signed | 2026-10-19 |\n`;

function run(content, extraArgs = [], migrationChecklist = completeMigrationChecklist) {
  fs.writeFileSync(fixturePath, content);
  fs.writeFileSync(path.join(docsDir, 'DOCS_SETUP.md'), migrationChecklist);
  // Create legacy pages that are listed as "Not migrating"
  fs.writeFileSync(path.join(docsDir, 'README.md'), '# README\n');
  // Create evidence file in fixture root (outside docs/)
  fs.writeFileSync(path.join(fixtureDir, 'evidence.md'), '# Evidence\n');
  // For incomplete checklist test, create the source file
  if (migrationChecklist === incompleteMigrationChecklist) {
    fs.writeFileSync(path.join(docsDir, 'protocol-overview.md'), '# Protocol Overview\n');
  }
  return spawnSync(process.execPath, [script, '--checklist', fixturePath, '--as-of', '2026-10-19', ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
  });
}

after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

describe('mainnet launch readiness control', () => {
  it('passes a fresh checklist with local evidence and independent sign-off', () => {
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
    const boundary = run(fixture('2026-09-19'));
    assert.equal(boundary.status, 0, boundary.stdout);
    const stale = run(fixture('2026-09-18'));
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /Checklist is stale/);
  });

  it('is deterministic across replay/restart and writes an operator report', () => {
    const reportPath = path.join(fixtureDir, 'report.json');
    const first = run(fixture(), ['--report', reportPath]);
    const second = run(fixture(), ['--report', reportPath]);
    assert.equal(first.status, 0);
    assert.equal(second.status, 0);
    assert.equal(second.stdout, first.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), JSON.parse(first.stdout));
  });

  it('blocks rehearsal when migration checklist has pending pages', () => {
    const result = run(fixture(), ['--rehearsal'], incompleteMigrationChecklist);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /migration checklist has 1 pending pages/);
  });

  describe('required evidence category coverage (issue #1501)', () => {
    it('fails closed when every required evidence category row is missing entirely', () => {
      fs.writeFileSync(fixturePath, fixtureMissingCategories());
      fs.writeFileSync(path.join(docsDir, 'DOCS_SETUP.md'), completeMigrationChecklist);
      fs.writeFileSync(path.join(docsDir, 'README.md'), '# README\n');
      fs.writeFileSync(path.join(fixtureDir, 'evidence.md'), '# Evidence\n');
      const result = spawnSync(
        process.execPath,
        [script, '--checklist', fixturePath, '--as-of', '2026-10-19'],
        { cwd: root, encoding: 'utf8' }
      );
      assert.equal(result.status, 1);
      const parsed = JSON.parse(result.stdout);
      for (const category of ['audit', 'signer', 'contract', 'health', 'rollback']) {
        assert.ok(
          parsed.errors.some((error) => error.includes(`required "${category}" evidence`)),
          `expected a missing-category error for "${category}", got: ${JSON.stringify(parsed.errors)}`
        );
      }
    });

    it('passes a checklist that includes an item for every required evidence category', () => {
      const result = run(fixture());
      assert.equal(result.status, 0, result.stdout);
      assert.equal(JSON.parse(result.stdout).result, 'passed');
    });

    it('still fails closed on missing categories under --rehearsal', () => {
      fs.writeFileSync(fixturePath, fixtureMissingCategories());
      fs.writeFileSync(path.join(docsDir, 'DOCS_SETUP.md'), completeMigrationChecklist);
      fs.writeFileSync(path.join(docsDir, 'README.md'), '# README\n');
      fs.writeFileSync(path.join(fixtureDir, 'evidence.md'), '# Evidence\n');
      const result = spawnSync(
        process.execPath,
        [script, '--checklist', fixturePath, '--as-of', '2026-10-19', '--rehearsal'],
        { cwd: root, encoding: 'utf8' }
      );
      assert.equal(result.status, 1);
      assert.match(result.stdout, /no item covering required[\s\S]*?audit/);
    });
  });
});
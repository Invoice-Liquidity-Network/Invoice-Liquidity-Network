import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  checkWorkflowPolicy,
  classifyUses,
  inventoryRows,
  loadWorkflows,
  parseWorkflow,
  writeInventory,
} from '../lib/workflow-policy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const CLI = join(repoRoot, 'scripts', 'check-workflow-policy.mjs');

const SHA_A = 'a15d269cd4658e1107c09f1fabf4cbd7bd1f308a';
const SHA_B = 'd1c1ffe0248fe513906c8e24db8ea791d46f8590';

const CI = `name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@${SHA_A} # v4.4.0
      - uses: ./.github/actions/setup-pnpm
`;
const DEPLOY = `name: Deploy
on: [workflow_dispatch]
permissions: {}
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo deploy
`;
const COMPOSITE = `name: setup
runs:
  using: composite
  steps:
    - uses: dorny/paths-filter@${SHA_B} # v3.0.3
`;

function doc(rows) {
  return `# CI/CD

Workflows: \`ci.yml\` and \`deploy.yml\`.

**Currently pinned third-party actions**

| Action | Pinned version |
| ------ | -------------- |
| \`pnpm/action-setup\` | v4.4.0 |
| \`dorny/paths-filter\` | v3.0.3 @ \`d1c1ffe\` |

## Workflow inventory (generated)

<!-- workflows:begin -->
${rows}
<!-- workflows:end -->
`;
}

let root;

function write(rel, content) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Regenerate both inventories from the fixture's workflows, as `--write` does. */
function syncDocs() {
  const rows = inventoryRows(loadWorkflows(root));
  write('docs/ci-cd.md', writeInventory(doc(''), rows));
  write(
    'packages/docs/content/ci-cd.mdx',
    writeInventory(doc('').replace(/<!-- (\w+):(\w+) -->/g, '{/* $1:$2 */}'), rows, { mdx: true })
  );
}

const rules = () => checkWorkflowPolicy(root).findings.map((f) => f.rule);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'iln-workflow-policy-'));
  write('.github/workflows/ci.yml', CI);
  write('.github/workflows/deploy.yml', DEPLOY);
  write('.github/actions/setup-pnpm/action.yml', COMPOSITE);
  syncDocs();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

// ── Success ───────────────────────────────────────────────────────────────────

describe('a compliant repository', () => {
  test('passes with no findings', () => {
    const result = checkWorkflowPolicy(root);
    assert.deepEqual(result.findings, []);
    assert.equal(result.summary.workflows, 2);
    assert.equal(result.summary.thirdPartyActions, 2);
  });

  test('the real repository passes (regression guard)', () => {
    const result = checkWorkflowPolicy(repoRoot);
    assert.deepEqual(
      result.findings.map((f) => `[${f.rule}] ${f.file}:${f.line} ${f.message}`),
      []
    );
    assert.ok(result.summary.workflows >= 54);
  });
});

// ── Failure: the original gaps ────────────────────────────────────────────────

describe('policy', () => {
  test('a workflow without top-level permissions', () => {
    write('.github/workflows/deploy.yml', DEPLOY.replace('permissions: {}\n', ''));
    syncDocs();
    assert.deepEqual(rules(), [RULES.PERMISSIONS]);
  });

  test('permissions: write-all', () => {
    write(
      '.github/workflows/deploy.yml',
      DEPLOY.replace('permissions: {}', 'permissions: write-all')
    );
    syncDocs();
    assert.deepEqual(rules(), [RULES.WRITE_ALL]);
  });

  test('a third-party action on a mutable tag, in a workflow and in a composite action', () => {
    write(
      '.github/workflows/ci.yml',
      CI.replace(`pnpm/action-setup@${SHA_A} # v4.4.0`, 'pnpm/action-setup@v4')
    );
    write('.github/actions/setup-pnpm/action.yml', COMPOSITE.replace(`@${SHA_B} # v3.0.3`, '@v3'));
    syncDocs();
    const r = rules();
    assert.equal(r.filter((x) => x === RULES.UNPINNED).length, 2);
  });

  test('a pin with no version comment', () => {
    write('.github/workflows/ci.yml', CI.replace(' # v4.4.0', ''));
    syncDocs();
    assert.ok(rules().includes(RULES.NO_VERSION));
  });
});

describe('exemptions', () => {
  const SLSA =
    'slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.1.0';
  const reason = 'The generator verifies its own reference and only supports release tags.';

  test('an exempted tag reference passes', () => {
    write('.github/workflows/deploy.yml', `${DEPLOY}  provenance:\n    uses: ${SLSA}\n`);
    write('.github/workflow-policy.json', JSON.stringify({ exemptions: [{ uses: SLSA, reason }] }));
    syncDocs();
    assert.deepEqual(rules(), []);
  });

  test('an exemption nothing uses is stale', () => {
    write('.github/workflow-policy.json', JSON.stringify({ exemptions: [{ uses: SLSA, reason }] }));
    assert.deepEqual(rules(), [RULES.STALE_EXEMPTION]);
  });

  test('an exemption must be a release tag, with a reason', () => {
    const branch = 'some/action@main';
    write(
      '.github/workflows/deploy.yml',
      `${DEPLOY.replace('run: echo deploy', `uses: ${branch}`)}`
    );
    write(
      '.github/workflow-policy.json',
      JSON.stringify({ exemptions: [{ uses: branch, reason: 'short' }] })
    );
    syncDocs();
    assert.deepEqual(rules(), [RULES.EXEMPTION, RULES.EXEMPTION]);
  });

  test('a malformed policy file fails closed', () => {
    write('.github/workflow-policy.json', '{ not json');
    assert.ok(rules().includes(RULES.EXEMPTION));
  });
});

describe('documentation', () => {
  test('an inventory that no longer matches a workflow (trigger changed)', () => {
    write(
      '.github/workflows/deploy.yml',
      DEPLOY.replace('on: [workflow_dispatch]', 'on: [workflow_dispatch, push]')
    );
    const r = rules();
    assert.deepEqual(r, [RULES.INVENTORY, RULES.INVENTORY]);
  });

  test('a new workflow missing from the inventory', () => {
    write('.github/workflows/new.yml', DEPLOY);
    assert.deepEqual(rules(), [RULES.INVENTORY]);
  });

  test('a document naming a workflow that does not exist', () => {
    const d = readFileSync(join(root, 'docs/ci-cd.md'), 'utf8').replace(
      '`deploy.yml`.',
      '`deploy.yml` and `scripts-release.yml`.'
    );
    write('docs/ci-cd.md', d);
    assert.deepEqual(rules(), [RULES.DEAD_REFERENCE]);
  });

  test('a pinned-actions table that misses an action, a version, or quotes a wrong SHA', () => {
    write(
      '.github/workflows/ci.yml',
      `${CI}      - uses: codecov/codecov-action@${SHA_B} # v5.5.5\n`
    );
    syncDocs();
    let d = readFileSync(join(root, 'docs/ci-cd.md'), 'utf8')
      .replace('| v4.4.0 |', '| v4.3.0 |')
      .replace('`d1c1ffe`', '`deadbee`');
    write('docs/ci-cd.md', d);
    const r = rules();
    assert.equal(r.filter((x) => x === RULES.PINNED_TABLE).length, 3);
  });

  test('a canonical port that drifted, or is missing', () => {
    write(
      'packages/docs/content/ci-cd.mdx',
      readFileSync(join(root, 'packages/docs/content/ci-cd.mdx'), 'utf8').replace(
        '`workflow_dispatch`',
        '`push`'
      )
    );
    assert.deepEqual(rules(), [RULES.PORT]);
    rmSync(join(root, 'packages/docs/content/ci-cd.mdx'));
    assert.deepEqual(rules(), [RULES.PORT]);
  });
});

// ── Replay, boundaries, unavailable input ─────────────────────────────────────

describe('replay and fail-closed behaviour', () => {
  test('--write is idempotent: a second run changes nothing (replay)', () => {
    write('.github/workflows/new.yml', DEPLOY);
    const first = spawnSync(process.execPath, [CLI, '--repo-root', root, '--write'], {
      encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /updated\s+docs\/ci-cd\.md/);
    const after = readFileSync(join(root, 'docs/ci-cd.md'), 'utf8');
    const second = spawnSync(process.execPath, [CLI, '--repo-root', root, '--write'], {
      encoding: 'utf8',
    });
    assert.equal(second.status, 0);
    assert.match(second.stdout, /unchanged docs\/ci-cd\.md/);
    assert.equal(readFileSync(join(root, 'docs/ci-cd.md'), 'utf8'), after);
  });

  test('the CLI exits 1 and writes a JSON report on a finding', () => {
    write('.github/workflows/deploy.yml', DEPLOY.replace('permissions: {}\n', ''));
    const report = join(root, 'report.json');
    const run = spawnSync(process.execPath, [CLI, '--repo-root', root, `--json=${report}`], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    const json = JSON.parse(readFileSync(report, 'utf8'));
    assert.ok(json.findings.some((f) => f.rule === RULES.PERMISSIONS));
  });

  test('an unreadable workflow fails closed instead of being skipped', () => {
    write('.github/workflows/broken.yml', 'name: x\nthis is not yaml at all\n');
    assert.ok(rules().includes(RULES.PARSE));
  });

  test('a missing CI/CD reference fails', () => {
    rmSync(join(root, 'docs/ci-cd.md'));
    assert.ok(rules().includes(RULES.INVENTORY));
  });
});

describe('boundaries', () => {
  test('SHA pins: exactly 40 lowercase hex characters', () => {
    const at = (ref) => {
      write(
        '.github/workflows/ci.yml',
        CI.replace(`pnpm/action-setup@${SHA_A}`, `pnpm/action-setup@${ref}`)
      );
      syncDocs();
      return rules().includes(RULES.UNPINNED);
    };
    assert.equal(at(SHA_A), false);
    assert.equal(at(SHA_A.slice(0, 39)), true);
    assert.equal(at(`${SHA_A}0`), true);
    assert.equal(at(SHA_A.toUpperCase()), true);
    assert.equal(at('main'), true);
  });

  test('first-party, local and digest-pinned docker references are not third-party tags', () => {
    assert.equal(classifyUses('actions/checkout@v4'), null);
    assert.equal(classifyUses('./.github/actions/setup-pnpm'), null);
    assert.deepEqual(classifyUses('github/codeql-action/init@abc'), {
      action: 'github/codeql-action/init',
      version: 'abc',
    });
    write(
      '.github/workflows/deploy.yml',
      DEPLOY.replace('run: echo deploy', 'uses: docker://alpine:3.20')
    );
    syncDocs();
    assert.ok(rules().includes(RULES.UNPINNED));
    write(
      '.github/workflows/deploy.yml',
      DEPLOY.replace('run: echo deploy', `uses: docker://alpine@sha256:${'a'.repeat(64)}`)
    );
    syncDocs();
    assert.deepEqual(rules(), []);
  });

  test('parseWorkflow reads every trigger, permission and concurrency form', () => {
    assert.deepEqual(parseWorkflow('on: push\npermissions: read-all\njobs: {}\n').triggers, [
      'push',
    ]);
    assert.deepEqual(parseWorkflow("'on':\n  - push\n  - pull_request\njobs: {}\n").triggers, [
      'push',
      'pull_request',
    ]);
    assert.deepEqual(
      parseWorkflow('on: [push]\npermissions: { contents: read, issues: write }\n').permissions,
      [
        { key: 'contents', value: 'read' },
        { key: 'issues', value: 'write' },
      ]
    );
    assert.deepEqual(parseWorkflow('on: [push]\npermissions: {}\n').permissions, []);
    assert.deepEqual(parseWorkflow('on: [push]\nconcurrency: release\n').concurrency, {
      group: 'release',
      cancel: false,
    });
    assert.equal(
      parseWorkflow(
        "on: [push]\nconcurrency:\n  group: x\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n"
      ).concurrency.cancel,
      'expression'
    );
  });

  test('every real workflow is readable (no silent skips)', () => {
    const workflows = loadWorkflows(repoRoot);
    assert.ok(workflows.length >= 54);
    assert.deepEqual(
      workflows.filter((w) => !w.parsed).map((w) => `${w.file}: ${w.error}`),
      []
    );
  });
});

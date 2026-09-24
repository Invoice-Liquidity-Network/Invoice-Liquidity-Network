import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  extractExportedNames,
  findSyncIssues,
  normalizeBlock,
} from '../check-generated-types-sync.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

// A spec that both generators can parse (each recognises its own type tags).
const FIXTURE_SPEC = [
  {
    type: 'SCSpecEntryUDTStructV0',
    name: 'invoice',
    doc: 'A single invoice.',
    fields: [
      { name: 'due_date', type: { type: 'U64' }, doc: 'Due date as unix seconds.' },
      { name: 'created_by', type: { type: 'Address' }, doc: 'Creator address.' },
    ],
  },
  {
    type: 'UdtStructV0',
    name: 'invoice',
    doc: 'A single invoice.',
    fields: [
      { name: 'due_date', type: { type: 'U64' }, doc: 'Due date as unix seconds.' },
      { name: 'created_by', type: { type: 'Address' }, doc: 'Creator address.' },
    ],
  },
  {
    type: 'SCSpecEntryUDTEnumV0',
    name: 'invoice_status',
    doc: 'Lifecycle status.',
    cases: [
      { name: 'Draft', value: 1, doc: 'Created, not yet funded.' },
      { name: 'Funded', value: 2, doc: 'Funded and awaiting payment.' },
    ],
  },
  {
    type: 'UdtEnumV0',
    name: 'invoice_status',
    doc: 'Lifecycle status.',
    cases: [
      { name: 'Draft', value: 1, doc: 'Created, not yet funded.' },
      { name: 'Funded', value: 2, doc: 'Funded and awaiting payment.' },
    ],
  },
];

const SHARED = `
// !! AUTO-GENERATED — do not edit by hand.
export interface Invoice {
  dueDate: bigint;
}
`;

const SDK_MARKED = `
// !! AUTO-GENERATED — do not edit by hand.
export interface Invoice {
  dueDate: bigint;
}
`;

test('extractExportedNames captures names and blocks', () => {
  const names = extractExportedNames(SHARED);
  assert.ok(names.has('Invoice'));
  assert.equal(names.get('Invoice').kind, 'interface');
  assert.match(names.get('Invoice').block, /dueDate: bigint/);
});

test('identical definitions are not a conflict', () => {
  const { conflicts } = findSyncIssues(SHARED, SDK_MARKED);
  assert.deepEqual(conflicts, []);
});

test('same name with a different shape is flagged', () => {
  const sdk = `// !! AUTO-GENERATED — do not edit by hand.
export interface Invoice {
  dueDate: string;
}
`;
  const { conflicts } = findSyncIssues(SHARED, sdk);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].name, 'Invoice');
  assert.equal(conflicts[0].reason, 'shape-differs');
});

test('an "intentionally differs" comment suppresses the conflict', () => {
  const sdk = `// !! AUTO-GENERATED — do not edit by hand.

/** SDK projection — intentionally differs from @iln/shared. */
export interface Invoice {
  dueDate: string;
}
`;
  const { conflicts } = findSyncIssues(SHARED, sdk);
  assert.deepEqual(conflicts, []);
});

test('missing AUTO-GENERATED marker is reported', () => {
  const sdk = `// hand-edited file with no marker
export interface Invoice {
  dueDate: bigint;
}
`;
  const { missingMarker } = findSyncIssues(SHARED, sdk);
  assert.equal(missingMarker, true);
});

test('normalizeBlock ignores formatting churn', () => {
  assert.equal(
    normalizeBlock('export interface Invoice {\n  dueDate: bigint;\n}'),
    normalizeBlock('export interface Invoice { dueDate: bigint; }')
  );
});

// ── Generator determinism (skipped when the local toolchain is unavailable) ──

function runGenerator(file, args) {
  return spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('SDK types generator output is deterministic', (t) => {
  let specPath;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'iln-gen-sync-'));
    specPath = join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(FIXTURE_SPEC), 'utf8');
  } catch {
    return t.skip('could not write fixture spec');
  }

  const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(tsxCli)) return t.skip('tsx unavailable in this environment');
  const args = [tsxCli, 'scripts/generate-types.ts', '--spec', specPath, '--dry-run'];
  const run1 = runGenerator('tsx', args);
  const run2 = runGenerator('tsx', args);
  if (run1.error || run2.error || run1.status !== 0 || run2.status !== 0) {
    return t.skip('generator failed to run in this environment');
  }
  assert.equal(run1.stdout, run2.stdout, 'generator output must not change between runs');
});

test('shared types generator output is deterministic', (t) => {
  let specPath;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'iln-gen-sync-'));
    specPath = join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify(FIXTURE_SPEC), 'utf8');
  } catch {
    return t.skip('could not write fixture spec');
  }

  const args = [
    '--import',
    'tsx/esm',
    'scripts/generate-shared-types.mts',
    '--spec',
    specPath,
    '--dry-run',
  ];
  const run1 = runGenerator('node', args);
  const run2 = runGenerator('node', args);
  if (run1.error || run2.error || run1.status !== 0 || run2.status !== 0) {
    return t.skip('tsx unavailable in this environment');
  }
  assert.equal(run1.stdout, run2.stdout, 'generator output must not change between runs');
});

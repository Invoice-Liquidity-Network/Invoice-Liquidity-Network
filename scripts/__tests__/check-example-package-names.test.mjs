import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkExamples } from '../check-example-package-names.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'scripts', 'check-example-package-names.mjs');

function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'iln-examples-'));
  const base = {
    'sdk/package.json': { name: '@iln/sdk', version: '0.1.0' },
    'packages/sdk/package.json': { name: '@iln/sdk-next', version: '0.1.0' },
    'packages/react/package.json': { name: '@iln/react', version: '0.1.0' },
  };
  for (const [path, content] of Object.entries({ ...base, ...files })) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
}
const rulesOf = (r) => r.findings.map((f) => f.rule);
const example = (extra = {}) => ({
  'examples/ok/package.json': { name: 'ok', dependencies: { '@iln/sdk': 'file:../../sdk' } },
  'examples/ok/index.ts': "import { ILNSdk } from '@iln/sdk';\n",
  'examples/ok/README.md': '```bash\nnpm install\n```\nUses `@iln/sdk`.\n',
  ...extra,
});

test('real repository: every example already uses canonical names (regression anchor)', () => {
  const report = checkExamples(REPO);
  assert.deepEqual(report.findings, []);
  assert.ok(report.examples.length >= 8, 'examples were discovered');
});

test('a consistent example passes', () => {
  const root = makeRepo(example());
  try {
    assert.equal(checkExamples(root).summary.ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown @iln package in source, README or manifest fails', () => {
  const root = makeRepo(
    example({
      'examples/ok/index.ts': "import { x } from '@iln/skd';\n",
      'examples/ok/README.md': 'npm install @iln/sdk-core\n',
    })
  );
  try {
    const r = checkExamples(root);
    const unknown = r.findings.filter((f) => f.rule === 'example-unknown-package');
    assert.equal(unknown.length, 2);
    assert.ok(unknown.some((f) => f.message.includes('@iln/skd')));
    assert.ok(unknown.some((f) => f.message.includes('@iln/sdk-core')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a real package imported but not declared fails (boundary: sdk-next vs sdk)', () => {
  const root = makeRepo(
    example({ 'examples/ok/index.ts': "import { c } from '@iln/sdk-next';\n" })
  );
  try {
    const r = checkExamples(root);
    assert.deepEqual(rulesOf(r), ['example-undeclared-import']);
    assert.match(r.findings[0].message, /@iln\/sdk-next/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deep and require() imports resolve to their package for the declared check', () => {
  const root = makeRepo(
    example({
      'examples/ok/index.js':
        "const a = require('@iln/sdk/legacy');\nconst b = require('@iln/react');\n",
    })
  );
  try {
    const r = checkExamples(root);
    assert.deepEqual(rulesOf(r), ['example-undeclared-import']);
    assert.match(r.findings[0].message, /@iln\/react/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an example without a manifest that imports @iln/* fails', () => {
  const root = makeRepo({ 'examples/bare/index.ts': "import { a } from '@iln/sdk';\n" });
  try {
    const r = checkExamples(root);
    assert.deepEqual(rulesOf(r), ['example-undeclared-import']);
    assert.match(r.findings[0].message, /no package\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('README npm install against a workspace: manifest fails; pnpm install passes', () => {
  const ws = {
    'examples/ok/package.json': { name: 'ok', dependencies: { '@iln/sdk': 'workspace:*' } },
  };
  const bad = makeRepo(example({ ...ws, 'examples/ok/README.md': '```bash\nnpm install\n```\n' }));
  const dockerBad = makeRepo(example({ ...ws, 'examples/ok/README.md': 'RUN npm install\n' }));
  const good = makeRepo(
    example({ ...ws, 'examples/ok/README.md': '```bash\npnpm install\nnpm install -g pm2\n```\n' })
  );
  try {
    assert.deepEqual(rulesOf(checkExamples(bad)), ['example-install-protocol']);
    assert.deepEqual(rulesOf(checkExamples(dockerBad)), ['example-install-protocol']);
    assert.equal(checkExamples(good).summary.ok, true);
  } finally {
    for (const r of [bad, dockerBad, good]) rmSync(r, { recursive: true, force: true });
  }
});

test('file: specifier + npm install is fine (npm can install file: deps)', () => {
  const root = makeRepo(example());
  try {
    assert.equal(checkExamples(root).summary.ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the allow-legacy pragma exempts a line, and only that line', () => {
  const root = makeRepo(
    example({
      'examples/ok/README.md':
        'Old name @iln/old-sdk <!-- sdk-name-check: allow-legacy -->\nBad @iln/other\n',
    })
  );
  try {
    const r = checkExamples(root);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].line, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replay: rerunning on the same tree gives an identical report', () => {
  const root = makeRepo(example({ 'examples/ok/index.ts': "import a from '@iln/skd';\n" }));
  try {
    assert.deepEqual(checkExamples(root), checkExamples(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: exits 1 on findings and writes the JSON evidence report', () => {
  const root = makeRepo(example({ 'examples/ok/index.ts': "import a from '@iln/skd';\n" }));
  const json = join(root, 'report.json');
  try {
    const run = spawnSync(process.execPath, [SCRIPT, `--root=${root}`, `--json=${json}`], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /example-package-names: FAIL/);
    const report = JSON.parse(readFileSync(json, 'utf8'));
    assert.equal(report.summary.ok, false);
    assert.equal(report.summary.byRule['example-unknown-package'], 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: exits 0 on the real repository', () => {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /example-package-names: OK/);
});

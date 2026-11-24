import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkSdkDeprecations, parseNotices, slugify } from '../check-sdk-deprecations.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'scripts', 'check-sdk-deprecations.mjs');

/** A minimal, passing repo; individual tests then break one thing. */
function makeRepo(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'iln-deprec-'));
  const files = {
    'sdk/package.json': JSON.stringify({
      name: '@iln/sdk',
      sideEffects: ['./dist/legacy-imports.mjs', './dist/legacy-imports.cjs'],
    }),
    'sdk/src/deprecation.ts':
      "export const DEPRECATION_NOTICES = { 'legacy-import': { id: 'legacy-import', code: 'ILN_SDK_DEPRECATED_LEGACY_IMPORT', docs: 'docs/sdk-migration-guide.md#deprecated-sdk-surface' } };\n",
    'sdk/src/legacy-imports.ts':
      "import { warnDeprecated } from './deprecation';\nwarnDeprecated('legacy-import');\nexport * from './index';\n",
    'sdk/src/legacy-imports.test.ts':
      "it('warns', () => { expect(code).toBe('ILN_SDK_DEPRECATED_LEGACY_IMPORT'); });\n",
    'docs/sdk-migration-guide.md':
      '# Guide\n\n## Deprecated SDK surface\n\nILN_SDK_DEPRECATED_LEGACY_IMPORT. Silence: ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS=1\n',
    ...overrides,
  };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
const withRepo = (overrides, fn) => {
  const root = makeRepo(overrides);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const rulesOf = (r) => r.findings.map((f) => f.rule);

test('real repository: the legacy-import notice is wired, tested, documented (regression anchor)', () => {
  const report = checkSdkDeprecations(REPO);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.notices, ['legacy-import']);
});

test('success on a minimal consistent repo', () => {
  withRepo({}, (root) => assert.equal(checkSdkDeprecations(root).summary.ok, true));
});

test('parseNotices and slugify behave like the docs renderer', () => {
  assert.deepEqual(
    parseNotices(readFileSync(join(REPO, 'sdk/src/deprecation.ts'), 'utf8')).map((n) => n.id),
    ['legacy-import']
  );
  assert.equal(slugify('Deprecated SDK surface'), 'deprecated-sdk-surface');
});

test('failure: notice declared but never called', () => {
  withRepo({ 'sdk/src/legacy-imports.ts': 'export * from "./index";\n' }, (root) =>
    assert.deepEqual(rulesOf(checkSdkDeprecations(root)), ['notice-not-wired'])
  );
});

test('failure: call site with an id missing from the registry', () => {
  withRepo(
    {
      'sdk/src/legacy-imports.ts': "warnDeprecated('legacy-import');\nwarnDeprecated('typo-id');\n",
    },
    (root) => assert.deepEqual(rulesOf(checkSdkDeprecations(root)), ['notice-uncatalogued'])
  );
});

test('failure: no test references the notice', () => {
  withRepo({ 'sdk/src/legacy-imports.test.ts': "it('unrelated', () => {});\n" }, (root) =>
    assert.deepEqual(rulesOf(checkSdkDeprecations(root)), ['notice-untested'])
  );
});

test('failure: docs heading, warning code, or env var missing', () => {
  withRepo({ 'docs/sdk-migration-guide.md': '# Guide\n' }, (root) =>
    assert.deepEqual(rulesOf(checkSdkDeprecations(root)), [
      'notice-undocumented',
      'notice-undocumented',
      'notice-undocumented',
    ])
  );
  withRepo(
    {
      'docs/sdk-migration-guide.md':
        '## Deprecated SDK surface\nILN_SDK_DEPRECATED_LEGACY_IMPORT\n',
    },
    (root) => {
      const r = checkSdkDeprecations(root);
      assert.deepEqual(rulesOf(r), ['notice-undocumented']);
      assert.match(r.findings[0].message, /ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS/);
    }
  );
});

test('boundary: sideEffects false, absent, or listing only one format drops the warning', () => {
  for (const sideEffects of [false, undefined, ['./dist/legacy-imports.mjs']]) {
    withRepo({ 'sdk/package.json': JSON.stringify({ name: '@iln/sdk', sideEffects }) }, (root) =>
      assert.deepEqual(
        rulesOf(checkSdkDeprecations(root)),
        ['side-effects-dropped'],
        JSON.stringify(sideEffects)
      )
    );
  }
});

test('boundary: a warning inside a function (not at module load) needs no sideEffects entry', () => {
  withRepo(
    {
      'sdk/package.json': JSON.stringify({ name: '@iln/sdk', sideEffects: false }),
      'sdk/src/legacy-imports.ts': "export function f() {\n  warnDeprecated('legacy-import');\n}\n",
    },
    (root) => assert.equal(checkSdkDeprecations(root).summary.ok, true)
  );
});

test('unavailable dependency: missing registry or manifest fails closed rather than passing', () => {
  withRepo({ 'sdk/src/deprecation.ts': null }, (root) =>
    assert.equal(checkSdkDeprecations(root).summary.ok, false)
  );
  withRepo({ 'sdk/package.json': 'not json' }, (root) =>
    assert.deepEqual(rulesOf(checkSdkDeprecations(root)), ['side-effects-dropped'])
  );
});

test('replay: the real sdk tree checked from a fresh copy gives the same verdict', () => {
  const copy = mkdtempSync(join(tmpdir(), 'iln-deprec-copy-'));
  try {
    cpSync(join(REPO, 'sdk/src'), join(copy, 'sdk/src'), { recursive: true });
    cpSync(join(REPO, 'sdk/package.json'), join(copy, 'sdk/package.json'));
    cpSync(join(REPO, 'docs/sdk-migration-guide.md'), join(copy, 'docs/sdk-migration-guide.md'));
    assert.deepEqual(checkSdkDeprecations(copy), checkSdkDeprecations(REPO));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test('CLI: exit 1 + JSON report on findings; exit 0 on the real repository', () => {
  const root = makeRepo({ 'docs/sdk-migration-guide.md': '# Guide\n' });
  const json = join(root, 'report.json');
  try {
    const bad = spawnSync(process.execPath, [SCRIPT, `--root=${root}`, `--json=${json}`], {
      encoding: 'utf8',
    });
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(readFileSync(json, 'utf8')).summary.byRule['notice-undocumented'], 3);
    const good = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

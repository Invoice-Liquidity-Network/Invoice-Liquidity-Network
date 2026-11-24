import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  TARGETS,
  buildConsumerManifest,
  checkCleanConsumer,
  findPackageCopies,
  loadTypeScript,
  prepareConsumerDir,
  selectTargets,
  verifyConsumer,
} from '../check-clean-consumer-install.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'scripts', 'check-clean-consumer-install.mjs');
const SDK = TARGETS.find((t) => t.pkg === '@iln/sdk');
const REACT = TARGETS.find((t) => t.pkg === '@iln/react');
const SYMBOLS = 'ILNSdk,ILN_TESTNET,createKeypairSigner,SDK_VERSION';

function write(root, path, content) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

/** Hand-built node_modules standing in for what `npm install` produced. */
function fakeSdk(
  root,
  { at = 'node_modules/@iln/sdk', symbols = SYMBOLS.split(','), legacy = true, types = true } = {}
) {
  const exportsMap = {
    '.': { types: './index.d.ts', import: './index.mjs', require: './index.cjs' },
    ...(legacy
      ? { './legacy': { types: './legacy.d.ts', import: './legacy.mjs', require: './legacy.cjs' } }
      : {}),
  };
  write(root, `${at}/package.json`, { name: '@iln/sdk', version: '0.1.0', exports: exportsMap });
  const cjs = `module.exports = { ${symbols.map((s) => `${s}: 1`).join(', ')} };`;
  const esm = symbols.map((s) => `export const ${s} = 1;`).join('\n');
  for (const [name, c, e] of [['index', cjs, esm], ...(legacy ? [['legacy', cjs, esm]] : [])]) {
    write(root, `${at}/${name}.cjs`, c);
    write(root, `${at}/${name}.mjs`, e);
    if (types) write(root, `${at}/${name}.d.ts`, 'export declare const SDK_VERSION: string;\n');
  }
}
function fakeShared(root) {
  write(root, 'node_modules/@iln/shared/package.json', {
    name: '@iln/shared',
    version: '0.1.0',
    exports: { '.': { types: './dist/index.d.ts' } },
  });
  write(root, 'node_modules/@iln/shared/dist/index.d.ts', 'export type X = 1;\n');
}
function consumer(setup) {
  const root = mkdtempSync(join(tmpdir(), 'iln-consumer-'));
  setup(root);
  return root;
}
const cleanup = (root) => rmSync(root, { recursive: true, force: true });
const rulesOf = (r) => r.findings.map((f) => f.rule);
const sdkOnly = [SDK];
const ts = loadTypeScript(REPO);

test('success: a clean install resolves under CJS and ESM', () => {
  const root = consumer((r) => fakeSdk(r));
  try {
    const result = verifyConsumer(root, sdkOnly, { skipTypes: true });
    assert.deepEqual(result.findings, []);
    assert.ok(result.checks.some((c) => c.check === 'cjs' && c.spec === '@iln/sdk/legacy' && c.ok));
    assert.ok(result.checks.some((c) => c.check === 'esm' && c.spec === '@iln/sdk' && c.ok));
  } finally {
    cleanup(root);
  }
});

test('failure: an entry point that loads but lacks a required export', () => {
  const root = consumer((r) => fakeSdk(r, { symbols: ['ILNSdk'] }));
  try {
    const found = verifyConsumer(root, sdkOnly, { skipTypes: true }).findings;
    assert.ok(found.length >= 2 && found.every((f) => f.rule === 'symbol-missing'));
    assert.match(found[0].message, /ILN_TESTNET/);
  } finally {
    cleanup(root);
  }
});

test('failure: a subpath export that was dropped from the package (boundary: ./legacy)', () => {
  const root = consumer((r) => fakeSdk(r, { legacy: false }));
  try {
    const rules = rulesOf(verifyConsumer(root, sdkOnly, { skipTypes: true }));
    assert.ok(rules.includes('cjs-resolve') && rules.includes('esm-resolve'));
  } finally {
    cleanup(root);
  }
});

test('failure: a package that was never installed', () => {
  const root = consumer(() => {});
  try {
    assert.ok(
      rulesOf(verifyConsumer(root, sdkOnly, { skipTypes: true })).includes('install-failed')
    );
  } finally {
    cleanup(root);
  }
});

test('failure: a nested second SDK copy is a duplicate and breaks peer identity', () => {
  const root = consumer((r) => {
    fakeSdk(r);
    fakeSdk(r, { at: 'node_modules/@iln/react/node_modules/@iln/sdk' });
    write(r, 'node_modules/@iln/react/package.json', {
      name: '@iln/react',
      version: '0.1.0',
      main: 'index.cjs',
    });
    write(
      r,
      'node_modules/@iln/react/index.cjs',
      'module.exports = { AmountDisplay: 1, ILNProvider: 1, useInvoice: 1 };'
    );
  });
  try {
    const rules = rulesOf(
      verifyConsumer(root, [SDK, { ...REACT, entries: [] }], { skipTypes: true })
    );
    assert.ok(rules.includes('duplicate-copy'));
    assert.ok(rules.includes('peer-identity'));
    assert.deepEqual(findPackageCopies(root, '@iln/sdk'), [
      'node_modules/@iln/react/node_modules/@iln/sdk',
      'node_modules/@iln/sdk',
    ]);
  } finally {
    cleanup(root);
  }
});

test('success: a peer that shares the consumer SDK passes the identity check', () => {
  const root = consumer((r) => {
    fakeSdk(r);
    write(r, 'node_modules/@iln/react/package.json', {
      name: '@iln/react',
      version: '0.1.0',
      main: 'index.cjs',
    });
    write(r, 'node_modules/@iln/react/index.cjs', 'module.exports = {};');
  });
  try {
    const result = verifyConsumer(root, [SDK, { ...REACT, entries: [] }], { skipTypes: true });
    assert.deepEqual(result.findings, []);
    assert.equal(result.checks.find((c) => c.check === 'peer-identity').sameInstance, true);
  } finally {
    cleanup(root);
  }
});

test('failure (fail closed): types cannot be verified without TypeScript, unless explicitly skipped', () => {
  const root = consumer((r) => fakeSdk(r));
  try {
    assert.ok(rulesOf(verifyConsumer(root, sdkOnly, { ts: null })).includes('types-unresolved'));
    assert.deepEqual(verifyConsumer(root, sdkOnly, { ts: null, skipTypes: true }).findings, []);
  } finally {
    cleanup(root);
  }
});

test(
  'types: a declaration inside node_modules passes; a missing or JS-only target fails',
  { skip: !ts && 'typescript not installed' },
  () => {
    const shared = TARGETS.find((t) => t.pkg === '@iln/shared');
    const good = consumer((r) => {
      fakeSdk(r);
      fakeShared(r);
    });
    const noTypes = consumer((r) => fakeSdk(r, { types: false }));
    try {
      assert.deepEqual(verifyConsumer(good, [SDK, shared], { ts }).findings, []);
      const bad = verifyConsumer(noTypes, sdkOnly, { ts }).findings;
      assert.ok(bad.length > 0 && bad.every((f) => f.rule === 'types-unresolved'));
    } finally {
      cleanup(good);
      cleanup(noTypes);
    }
  }
);

test('manifest: tarballs are file: dependencies and transitive @iln/* are pinned to them via overrides', () => {
  const manifest = buildConsumerManifest({
    tarballs: [
      { pkg: '@iln/sdk', file: '../tarballs/iln-sdk-0.1.0.tgz' },
      { pkg: '@iln/shared', file: '../tarballs/iln-shared-0.1.0.tgz' },
    ],
  });
  assert.equal(manifest.dependencies['@iln/sdk'], 'file:../tarballs/iln-sdk-0.1.0.tgz');
  assert.equal(manifest.overrides['@iln/shared'], '$@iln/shared');
  assert.equal(
    manifest.dependencies.react,
    undefined,
    'react peers only when @iln/react is installed'
  );
  const withReact = buildConsumerManifest({
    tarballs: [{ pkg: '@iln/react', file: '../t/r.tgz' }],
    includeReact: true,
  });
  assert.equal(withReact.dependencies.react, '^19.0.0');
  assert.equal(withReact.dependencies['@tanstack/react-query'], '^5.62.0');
});

test('targets: @iln/react is opt-in', () => {
  assert.deepEqual(
    selectTargets().map((t) => t.pkg),
    ['@iln/sdk', '@iln/shared']
  );
  assert.deepEqual(
    selectTargets({ includeReact: true }).map((t) => t.pkg),
    ['@iln/sdk', '@iln/shared', '@iln/react']
  );
});

test('restart/replay: a stale consumer directory is wiped, so leftovers cannot mask a regression', () => {
  const root = consumer((r) => write(r, 'consumer/node_modules/@iln/sdk/leftover.txt', 'stale'));
  try {
    const dir = prepareConsumerDir(join(root, 'consumer'));
    assert.deepEqual(findPackageCopies(dir, '@iln/sdk'), []);
    // Verification is deterministic across repeated runs on the same tree.
    fakeSdk(dir);
    assert.deepEqual(
      verifyConsumer(dir, sdkOnly, { skipTypes: true }),
      verifyConsumer(dir, sdkOnly, { skipTypes: true })
    );
  } finally {
    cleanup(root);
  }
});

test('unavailable dependency: a tarball that cannot be installed is install-failed, not a crash or a pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'iln-cc-root-'));
  try {
    // Fake repo: sdk/ has a dist and a manifest, but the packed tarball will not install
    // (its dependency spec points at a file that does not exist).
    write(root, 'sdk/package.json', {
      name: '@iln/sdk',
      version: '0.1.0',
      files: ['dist'],
      dependencies: { missing: 'file:../nope.tgz' },
    });
    write(root, 'sdk/dist/index.cjs', 'module.exports={}');
    write(root, 'packages/shared/package.json', {
      name: '@iln/shared',
      version: '0.1.0',
      files: ['dist'],
    });
    write(root, 'packages/shared/dist/index.d.ts', 'export {};');
    const report = checkCleanConsumer(root, { build: false, skipTypes: true });
    assert.equal(report.summary.ok, false);
    assert.ok(
      ['install-failed', 'pack-failed'].includes(report.findings[0].rule),
      report.findings[0].rule
    );
  } finally {
    cleanup(root);
  }
});

test('fail closed: a package with no dist/ cannot be packed and says so (--no-build)', () => {
  const root = mkdtempSync(join(tmpdir(), 'iln-cc-root-'));
  try {
    write(root, 'sdk/package.json', { name: '@iln/sdk', version: '0.1.0' });
    write(root, 'packages/shared/package.json', { name: '@iln/shared', version: '0.1.0' });
    const report = checkCleanConsumer(root, { build: false, skipTypes: true });
    assert.deepEqual(rulesOf(report), ['pack-failed', 'pack-failed']);
    assert.match(report.findings[0].message, /dist is missing/);
  } finally {
    cleanup(root);
  }
});

test('CLI: exits 1 and still writes the JSON evidence report when the repo cannot be packed', () => {
  const root = mkdtempSync(join(tmpdir(), 'iln-cc-root-'));
  const json = join(root, 'report.json');
  try {
    const run = spawnSync(
      process.execPath,
      [SCRIPT, `--root=${root}`, `--no-build`, `--skip-types`, `--json=${json}`],
      { encoding: 'utf8' }
    );
    assert.equal(run.status, 1);
    assert.match(run.stdout, /clean-consumer-install: FAIL/);
    const report = JSON.parse(readFileSync(json, 'utf8'));
    assert.equal(report.summary.ok, false);
    assert.ok(report.environment.node);
    assert.ok(report.skipped.length > 0);
  } finally {
    cleanup(root);
  }
});

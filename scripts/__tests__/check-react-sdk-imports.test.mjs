import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkReactImports, collectExports } from '../check-react-sdk-imports.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'scripts', 'check-react-sdk-imports.mjs');

function makeRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'iln-react-'));
  const base = {
    'sdk/package.json': { name: '@iln/sdk', version: '0.1.0' },
    'sdk/src/index.ts':
      "export * from './client';\nexport { Helper as PublicHelper } from './helper';\nexport type { Invoice } from './types';\nexport const SDK_VERSION = '0.1.0';\n",
    'sdk/src/client.ts':
      'export class ILNSdk {}\nexport function createSigner() {}\nexport enum Status { A }\nexport interface Opts {}\n',
    'sdk/src/helper.ts': 'export const Helper = 1;\n',
    'sdk/src/types.ts': 'export interface Invoice {}\n',
    'packages/react/package.json': {
      name: '@iln/react',
      peerDependencies: { '@iln/sdk': '^0.1.0' },
      dependencies: { '@iln/shared': 'workspace:*' },
    },
    'packages/react/src/ok.ts':
      "import { ILNSdk, type Invoice, PublicHelper as H } from '@iln/sdk';\nimport type { Dispute } from '@iln/shared';\n",
  };
  for (const [path, content] of Object.entries({ ...base, ...files })) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
}
const rulesOf = (r) => r.findings.map((f) => f.rule);
const withRepo = (files, fn) => {
  const root = makeRepo(files);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('real repository: @iln/react imports only the canonical, declared, existing SDK surface', () => {
  const report = checkReactImports(REPO);
  assert.deepEqual(report.findings, []);
  assert.ok(report.files > 20, 'react sources were scanned');
  assert.ok(report.sdkExports > 100, 'the SDK export graph was resolved');
});

test('success: canonical imports, aliases and type-only imports pass', () => {
  withRepo({}, (root) => assert.equal(checkReactImports(root).summary.ok, true));
});

test('collectExports follows export *, aliases, type exports and declarations', () => {
  withRepo({}, (root) => {
    const { names, unresolved } = collectExports(join(root, 'sdk/src/index.ts'));
    assert.deepEqual(unresolved, []);
    for (const n of [
      'ILNSdk',
      'createSigner',
      'Status',
      'Opts',
      'PublicHelper',
      'Invoice',
      'SDK_VERSION',
    ]) {
      assert.ok(names.has(n), `${n} is exported`);
    }
    assert.ok(!names.has('Helper'), 'the un-aliased name is not public');
  });
});

test('failure: @iln/sdk-next is rejected', () => {
  withRepo({ 'packages/react/src/bad.ts': "import { a } from '@iln/sdk-next';\n" }, (root) => {
    const r = checkReactImports(root);
    assert.ok(rulesOf(r).includes('react-sdk-specifier'));
    assert.ok(r.findings.some((f) => /experimental/.test(f.message)));
  });
});

test('failure: deep import of the SDK, including the deprecated /legacy shim, is rejected', () => {
  withRepo(
    {
      'packages/react/src/a.ts': "import { x } from '@iln/sdk/legacy';\n",
      'packages/react/src/b.ts': "const y = require('@iln/sdk/dist/index.cjs');\n",
    },
    (root) => {
      const r = checkReactImports(root).findings.filter((f) => f.rule === 'react-sdk-specifier');
      assert.equal(r.length, 2);
    }
  );
});

test('failure: relative import into sdk/ or packages/sdk/ is rejected', () => {
  withRepo(
    {
      'packages/react/src/a.ts': "import { x } from '../../../sdk/src/client';\n",
      'packages/react/src/b.ts': "import { y } from '../../sdk/src/index';\n",
    },
    (root) => {
      const r = checkReactImports(root);
      assert.equal(r.findings.filter((f) => f.rule === 'react-sdk-specifier').length, 2);
    }
  );
});

test('boundary: ordinary relative imports inside react are fine, even in a folder named sdk', () => {
  withRepo(
    {
      'packages/react/src/c.ts':
        "import { z } from './ok';\nimport { w } from '../src/ok';\nimport { s } from './sdk/local';\n",
      'packages/react/src/sdk/local.ts': 'export const s = 1;\n',
    },
    (root) => assert.equal(checkReactImports(root).summary.ok, true)
  );
});

test('failure: an @iln package imported but not declared is rejected (the #1221 @iln/shared gap)', () => {
  withRepo(
    {
      'packages/react/package.json': {
        name: '@iln/react',
        peerDependencies: { '@iln/sdk': '^0.1.0' },
      },
    },
    (root) => {
      const r = checkReactImports(root);
      assert.deepEqual(rulesOf(r), ['react-undeclared-import']);
      assert.match(r.findings[0].message, /@iln\/shared/);
    }
  );
});

test('failure: a named import the SDK does not export is rejected, including multi-line imports', () => {
  withRepo(
    {
      'packages/react/src/m.ts':
        "import {\n  ILNSdk,\n  NotARealExport,\n  type AlsoMissing,\n} from '@iln/sdk';\n",
    },
    (root) => {
      const r = checkReactImports(root).findings.filter(
        (f) => f.rule === 'react-sdk-missing-export'
      );
      assert.deepEqual(r.map((f) => f.message.match(/"([^"]+)"/)[1]).sort(), [
        'AlsoMissing',
        'NotARealExport',
      ]);
    }
  );
});

test('unavailable dependency: an unresolvable SDK export graph fails closed instead of skipping', () => {
  withRepo(
    { 'sdk/src/index.ts': "export * from 'some-bare-package';\nexport * from './client';\n" },
    (root) => {
      const r = checkReactImports(root);
      assert.ok(
        r.findings.some(
          (f) => f.rule === 'react-sdk-missing-export' && /fail closed/.test(f.message)
        )
      );
    }
  );
});

test('unavailable dependency: a missing SDK entry or react manifest is a finding, not a crash', () => {
  const noSdk = mkdtempSync(join(tmpdir(), 'iln-react-'));
  try {
    mkdirSync(join(noSdk, 'packages/react/src'), { recursive: true });
    writeFileSync(join(noSdk, 'packages/react/package.json'), '{"name":"@iln/react"}');
    assert.equal(checkReactImports(noSdk).summary.ok, false);
    assert.equal(checkReactImports(join(noSdk, 'nowhere')).summary.ok, false);
  } finally {
    rmSync(noSdk, { recursive: true, force: true });
  }
});

test('the allow-legacy pragma exempts a line', () => {
  withRepo(
    {
      'packages/react/src/p.ts':
        "import { x } from '@iln/sdk/legacy'; // sdk-name-check: allow-legacy\n",
    },
    (root) => assert.equal(checkReactImports(root).summary.ok, true)
  );
});

test('replay: rerunning gives an identical report', () => {
  withRepo({ 'packages/react/src/bad.ts': "import { a } from '@iln/sdk-next';\n" }, (root) =>
    assert.deepEqual(checkReactImports(root), checkReactImports(root))
  );
});

test('CLI: exits 1 with a JSON evidence report on findings, 0 on the real repository', () => {
  const root = makeRepo({ 'packages/react/src/bad.ts': "import { a } from '@iln/sdk-next';\n" });
  const json = join(root, 'report.json');
  try {
    const bad = spawnSync(process.execPath, [SCRIPT, `--root=${root}`, `--json=${json}`], {
      encoding: 'utf8',
    });
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(readFileSync(json, 'utf8')).summary.ok, false);
    const good = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stdout);
    assert.match(good.stdout, /react-sdk-imports: OK/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Tests for scripts/lib/local-dev-docs.mjs (#1285).
 *
 * A compliant fixture repository passes; each rule is then broken one at a
 * time and must fire. The real repository must pass too.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkLocalDevDocs,
  classifyPnpm,
  collectEnvReads,
  parseCompose,
  parseEnvExample,
  parseMakefile,
  parseWorkspaceGlobs,
  pnpmInvocations,
} from '../lib/local-dev-docs.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO, 'scripts', 'check-local-dev-docs.mjs');

const GUIDE = `# Local Development

See [the map](monorepo-map.md).

## Prerequisites

| Tool | Required version | Why |
| --- | --- | --- |
| Node.js | \`>=20\` | runtime |
| pnpm | \`>=9\` | package manager |

## Install

- \`indexer/\`, \`oracle-service/\`, \`docs/\`, \`packages/*\`, \`examples/*\`

## Environment Variables

\`\`\`bash
cp indexer/.env.example indexer/.env
\`\`\`

\`oracle-service/\` has no \`.env.example\`.

### Indexer Variables

| Variable | Default | Description |
| --- | --- | --- |
| \`PORT\` | \`3001\` | port |
| \`RPC_URL\` | (unset) | rpc |

### Notifications Variables

| Variable | Default | Description |
| --- | --- | --- |
| \`LIMIT_A\` / \`LIMIT_B\` | \`60\` / \`200\` | limits |

### Oracle Service Variables

| Variable | Default | Description |
| --- | --- | --- |
| \`ORACLE_PORT\` | \`3010\` | port |

### Docs Variables

| Variable | Description |
| --- | --- |
| \`NEXT_PUBLIC_KEY\` | key |

## Start the Docker Stack

Make sure ports \`8000\`, \`3001\`, and \`3010\` are free.

\`docker-compose.yml\` defines three services:

| Service | Purpose | Port(s) |
| --- | --- | --- |
| \`node\` | chain | \`8000\` |
| \`svc\` | Runs \`pnpm --filter svc-pkg dev\` here. | \`3001\` |
| \`oracle\` | Runs \`pnpm oracle:dev\`. | \`3010\` |

| File | Contents |
| --- | --- |
| \`.docker-output/contract-id.txt\` | id |

## Catalog

| Path | Package | Test |
| --- | --- | --- |
| \`indexer/\` | \`svc-pkg\` | \`pnpm --filter svc-pkg test\` |
| \`packages/lib/\` | \`@x/lib\` | \`pnpm --filter @x/lib... build\` |

Examples: \`demo\`. Run one with \`pnpm --filter <example> start\`.

\`\`\`bash
pnpm install
pnpm oracle:test   # root wrapper
make build && make setup
\`\`\`

| Script | Invoked by | Purpose |
| --- | --- | --- |
| \`scripts/dev-setup.sh\` | \`make setup\` | Installs \`wasm32v1-none\`. |
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'local-dev-docs-'));
  const files = {
    'docs/local-development.md': GUIDE,
    'docs/monorepo-map.md': '# map\n',
    'packages/docs/content/local-development.mdx':
      '{/* port */}\n\n' +
      GUIDE.replace(
        '(monorepo-map.md)',
        '(https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/dev/docs/monorepo-map.md)'
      ),
    'package.json': JSON.stringify(
      {
        name: 'root',
        engines: { node: '>=20', pnpm: '>=9' },
        scripts: {
          'oracle:dev': 'pnpm --filter oracle-pkg run dev',
          'oracle:test': 'pnpm --filter oracle-pkg run test',
        },
      },
      null,
      2
    ),
    'pnpm-workspace.yaml':
      "packages:\n  - indexer\n  - oracle-service # the oracle\n  - docs\n  - 'packages/*'\n  - 'examples/*'\n",
    'indexer/package.json': JSON.stringify({ name: 'svc-pkg', scripts: { dev: 'x', test: 'x' } }),
    'indexer/.env.example': 'PORT=3001\n# RPC_URL=http://x\n',
    'indexer/src/config.ts':
      "export const c = { port: Number(process.env.PORT ?? '3001'), rpc: process.env.RPC_URL };\n",
    'indexer/src/config.test.ts': 'process.env.TEST_ONLY_VAR;\n',
    'oracle-service/package.json': JSON.stringify({
      name: 'oracle-pkg',
      scripts: { dev: 'x', test: 'x' },
    }),
    'oracle-service/src/index.ts':
      'const DEFAULT_PORT = 3010;\nexport const p = Number(process.env.ORACLE_PORT ?? DEFAULT_PORT);\n',
    'notifications/src/config.ts':
      "const a = parseIntEnv('LIMIT_A', 60);\nconst b = parseInt(process.env.LIMIT_B ?? '200', 10);\n",
    'docs/package.json': JSON.stringify({ name: 'docs-pkg', scripts: {} }),
    'docs/components/Search.tsx': 'const k = process.env.NEXT_PUBLIC_KEY;\n',
    'packages/lib/package.json': JSON.stringify({ name: '@x/lib', scripts: { build: 'x' } }),
    'examples/demo/package.json': JSON.stringify({ name: 'demo', scripts: { start: 'x' } }),
    'docker-compose.yml': `# This file manages three services.
services:
  node:
    image: quickstart
    ports:
      - '8000:8000' # rpc
  svc:
    image: node:20
    command: >-
      sh -lc 'pnpm install --frozen-lockfile &&
      pnpm --filter svc-pkg dev'
    ports:
      - "3001:3001"
  oracle:
    image: node:20
    command: sh -lc "pnpm oracle:dev"
    ports:
      - '127.0.0.1:3010:3010'
`,
    Makefile:
      '.PHONY: setup build\nsetup:\n\t@./scripts/dev-setup.sh\nbuild:\n\t@cd backend && cargo build --target wasm32v1-none\n\t@ls target/wasm32v1-none/release\n',
    '.gitmodules':
      '[submodule "backend"]\n\tpath = backend\n\turl = https://example.invalid/b.git\n',
    'scripts/dev-setup.sh':
      '#!/bin/sh\nfor target in wasm32v1-none; do\n  rustup target add "$target"\ndone\n',
    'contract-deployer/deploy.sh': 'echo x > .docker-output/contract-id.txt\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const roots = [];
function repo(mutate) {
  const root = fixture();
  roots.push(root);
  if (mutate) mutate(root);
  return root;
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

const edit = (root, rel, fn) =>
  writeFileSync(join(root, rel), fn(readFileSync(join(root, rel), 'utf8')));
const rules = (root) => checkLocalDevDocs(root).findings.map((f) => f.rule);

describe('parsers', () => {
  it('reads pnpm-workspace globs, ignoring comments and quotes', () => {
    assert.deepEqual(
      parseWorkspaceGlobs("# c\npackages:\n  - sdk # x\n  - 'packages/*'\nother:\n  - no\n"),
      ['sdk', 'packages/*']
    );
  });

  it('reads compose services, host ports and every command form', () => {
    const c = parseCompose(
      "# manages two services\nservices:\n  a:\n    command: ['sh', '-c', 'pnpm x']\n    ports:\n      - '1:2'\n      - 0.0.0.0:3:4\n  b:\n    command: |\n      one\n      two\nvolumes:\n  v:\n"
    );
    assert.deepEqual([...c.services.keys()], ['a', 'b']);
    assert.equal(c.services.get('a').command, 'sh -c pnpm x');
    assert.deepEqual(c.services.get('a').ports, [1, 3]);
    assert.equal(c.services.get('b').command, 'one\ntwo');
    assert.match(c.headerComment, /manages two services/);
  });

  it('reads Makefile targets and recipe cd targets (not variables)', () => {
    const mk = parseMakefile('.PHONY: a\nX := 1\na: b\n\t@cd dir && make\nb:\n\techo cd-not\n');
    assert.deepEqual([...mk.targets], ['a', 'b']);
    assert.deepEqual(
      mk.cds.map((c) => c.dir),
      ['dir']
    );
  });

  it('reads .env.example keys, including commented ones', () => {
    assert.deepEqual(
      parseEnvExample('A=1\n# B=2\n# Testnet: https://x\nlower=1\n').map((k) => k.key),
      ['A', 'B']
    );
  });

  it('splits pnpm invocations out of shell strings and strips quotes', () => {
    assert.deepEqual(
      pnpmInvocations("sh -lc 'corepack enable && pnpm install && pnpm --filter a dev'"),
      [['install'], ['--filter', 'a', 'dev']]
    );
  });

  it('classifies pnpm commands', () => {
    assert.deepEqual(classifyPnpm(['--filter', 'a', 'run', 'b']), {
      kind: 'filter',
      pkg: 'a',
      script: 'b',
    });
    assert.deepEqual(classifyPnpm(['-F', 'a', 'b']), { kind: 'filter', pkg: 'a', script: 'b' });
    assert.deepEqual(classifyPnpm(['--filter=a', 'b']), { kind: 'filter', pkg: 'a', script: 'b' });
    assert.deepEqual(classifyPnpm(['dev', '-w', 'pkg']), {
      kind: 'workspace-root-flag',
      script: 'dev',
      arg: 'pkg',
    });
    assert.deepEqual(
      classifyPnpm(['-w', 'add', 'x']),
      null,
      'pnpm -w add is a builtin, not a script'
    );
    assert.deepEqual(classifyPnpm(['lint']), { kind: 'root', script: 'lint' });
    assert.equal(classifyPnpm(['install', '--frozen-lockfile']), null);
    assert.equal(classifyPnpm(['--version']), null);
  });

  it('collects env reads and defaults, skipping tests', () => {
    const root = repo();
    const svc = collectEnvReads(root, 'indexer');
    assert.deepEqual([...svc.get('PORT')], ['3001']);
    assert.ok(svc.has('RPC_URL'));
    assert.ok(!svc.has('TEST_ONLY_VAR'));
    assert.deepEqual(
      [...collectEnvReads(root, 'oracle-service').get('ORACLE_PORT')],
      ['3010'],
      'constant default resolved'
    );
    assert.deepEqual(
      [...collectEnvReads(root, 'notifications').get('LIMIT_A')],
      ['60'],
      'helper default'
    );
  });
});

describe('checkLocalDevDocs', () => {
  it('passes a compliant repository', () => {
    const result = checkLocalDevDocs(repo());
    assert.deepEqual(result.findings, []);
    assert.equal(result.summary.ok, true);
    assert.ok(result.summary.commands >= 6);
    assert.equal(result.summary.services, 3);
  });

  it('passes the real repository', () => {
    const result = checkLocalDevDocs(REPO);
    assert.deepEqual(result.findings, []);
    assert.ok(result.summary.envVars > 50, 'every service table is checked');
  });

  const cases = [
    [
      'root-script-npm-workspace',
      (r) =>
        edit(r, 'package.json', (s) =>
          s.replace('pnpm --filter oracle-pkg run dev', 'npm run dev -w oracle-pkg')
        ),
    ],
    [
      'pnpm-workspace-root-flag',
      (r) =>
        edit(r, 'docker-compose.yml', (s) =>
          s.replace('pnpm --filter svc-pkg dev', 'pnpm dev -w svc-pkg')
        ),
    ],
    [
      'filter-unknown-package',
      (r) =>
        edit(r, 'docs/local-development.md', (s) =>
          s.replace('--filter svc-pkg test', '--filter svc-pkgg test')
        ),
    ],
    [
      'filter-unknown-script',
      (r) =>
        edit(r, 'docs/local-development.md', (s) =>
          s.replace('--filter svc-pkg test', '--filter svc-pkg tset')
        ),
    ],
    [
      'root-script-missing',
      (r) =>
        edit(r, 'docs/local-development.md', (s) =>
          s.replace('pnpm oracle:test', 'pnpm oracle:tests')
        ),
    ],
    [
      'make-target-missing',
      (r) => edit(r, 'docs/local-development.md', (s) => s.replace('make build', 'make deploy')),
    ],
    ['make-cd-missing', (r) => edit(r, 'Makefile', (s) => s.replace('cd backend', 'cd contracts'))],
    [
      'wasm-target-not-installed',
      (r) =>
        edit(r, 'scripts/dev-setup.sh', (s) =>
          s.replace('wasm32v1-none', 'wasm32-unknown-unknown')
        ),
    ],
    [
      'dev-setup-target-drift',
      (r) =>
        edit(r, 'docs/local-development.md', (s) =>
          s.replace('Installs `wasm32v1-none`', 'Installs `wasm32-unknown-unknown`')
        ),
    ],
    [
      'path-missing',
      (r) => edit(r, 'docs/local-development.md', (s) => s + '\nSee `scripts/missing.mjs`.\n'),
    ],
    [
      'link-missing',
      (r) =>
        edit(r, 'docs/local-development.md', (s) =>
          s.replace('(monorepo-map.md)', '(monorepo.md)')
        ),
    ],
    [
      'prerequisite-drift',
      (r) => edit(r, 'package.json', (s) => s.replace('"node": ">=20"', '"node": ">=22"')),
    ],
    ['workspace-undocumented', (r) => edit(r, 'pnpm-workspace.yaml', (s) => s + '  - tools\n')],
    [
      'example-undocumented',
      (r) => writeFileSync(join(mkdirP(r, 'examples/other'), 'package.json'), '{"name":"other"}'),
    ],
    [
      'package-name-drift',
      (r) => edit(r, 'indexer/package.json', (s) => s.replace('"svc-pkg"', '"svc-renamed"')),
    ],
    ['env-example-missing', (r) => rmSync(join(r, 'indexer/.env.example'))],
    [
      'env-example-claim',
      (r) => writeFileSync(join(r, 'oracle-service/.env.example'), 'ORACLE_PORT=3010\n'),
    ],
    [
      'env-var-unread',
      (r) => edit(r, 'indexer/src/config.ts', (s) => s.replace('process.env.RPC_URL', 'undefined')),
    ],
    [
      'env-default-drift',
      (r) => edit(r, 'oracle-service/src/index.ts', (s) => s.replace('3010;', '3011;')),
    ],
    [
      'env-default-drift',
      (r) => edit(r, 'notifications/src/config.ts', (s) => s.replace("'200'", "'250'")),
    ],
    ['env-example-undocumented', (r) => edit(r, 'indexer/.env.example', (s) => s + 'NEW_KEY=1\n')],
    ['env-example-unread', (r) => edit(r, 'indexer/.env.example', (s) => s + 'TEST_ONLY_VAR=1\n')],
    [
      'env-section-missing',
      (r) =>
        edit(r, 'docs/local-development.md', (s) =>
          s.replace('### Docs Variables', '### Site Variables')
        ),
    ],
    [
      'compose-service-drift',
      (r) => edit(r, 'docker-compose.yml', (s) => s.replace('  oracle:\n', '  oracle-service:\n')),
    ],
    [
      'compose-port-drift',
      (r) => edit(r, 'docker-compose.yml', (s) => s.replace("'8000:8000'", "'8001:8000'")),
    ],
    [
      'compose-command-drift',
      (r) =>
        edit(r, 'docker-compose.yml', (s) => s.replace('pnpm oracle:dev', 'pnpm oracle:start')),
    ],
    [
      'compose-count-drift',
      (r) =>
        edit(r, 'docs/local-development.md', (s) =>
          s.replace('defines three services', 'defines four services')
        ),
    ],
    [
      'compose-count-drift',
      (r) =>
        edit(r, 'docker-compose.yml', (s) =>
          s.replace('manages three services', 'manages two services')
        ),
    ],
    [
      'docker-output-unwritten',
      (r) => edit(r, 'contract-deployer/deploy.sh', () => 'echo nothing\n'),
    ],
    [
      'compose-table-missing',
      (r) =>
        edit(r, 'docs/local-development.md', (s) =>
          s.replace('| Service | Purpose | Port(s) |', '| Svc | Purpose | Notes |')
        ),
    ],
    ['compose-unreadable', (r) => rmSync(join(r, 'docker-compose.yml'))],
    [
      'canonical-port-missing',
      (r) => rmSync(join(r, 'packages/docs/content/local-development.mdx')),
    ],
    [
      'canonical-port-drift',
      (r) =>
        edit(r, 'docs/local-development.md', (s) =>
          s.replace('| `3001` | port |', '| `3002` | port |')
        ),
    ],
    [
      'canonical-port-drift',
      (r) =>
        edit(r, 'packages/docs/content/local-development.mdx', (s) =>
          s.replace('make build && ', '')
        ),
    ],
  ];

  for (const [rule, mutate] of cases) {
    it(`fires ${rule} (${mutate.toString().slice(9, 70).replace(/\s+/g, ' ')}…)`, () => {
      assert.ok(
        rules(repo(mutate)).includes(rule),
        `expected ${rule}, got ${JSON.stringify(rules(repo(mutate)))}`
      );
    });
  }

  it('ignores placeholders, globs and dependency selectors in commands', () => {
    const root = repo((r) =>
      edit(
        r,
        'docs/local-development.md',
        (s) => s + '\n`pnpm --filter <pkg> build` `pnpm docs:*` `pnpm --filter ...@x/lib build`\n'
      )
    );
    assert.deepEqual(rules(root), []);
  });

  it('accepts a documented non-literal default without comparing it', () => {
    const root = repo((r) => {
      for (const f of [
        'docs/local-development.md',
        'packages/docs/content/local-development.mdx',
      ]) {
        edit(r, f, (s) => s.replace('| `3010` | port |', '| 3 thousand and ten | port |'));
      }
    });
    assert.deepEqual(rules(root), []);
  });

  it('fails closed on unreadable inputs', () => {
    assert.deepEqual(rules(repo((r) => rmSync(join(r, 'docs/local-development.md')))), [
      'doc-unreadable',
    ]);
    assert.deepEqual(rules(repo((r) => writeFileSync(join(r, 'package.json'), '{ nope'))), [
      'repo-unreadable',
    ]);
    assert.deepEqual(rules(repo((r) => rmSync(join(r, 'pnpm-workspace.yaml')))), [
      'repo-unreadable',
    ]);
  });
});

describe('CLI', () => {
  it('exits 0 with a summary on the real repository and writes JSON', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'ldd-json-')), 'r.json');
    const summary = join(dirname(out), 'summary.md');
    const stdout = execFileSync(process.execPath, [CLI, `--json=${out}`], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    assert.match(stdout, /matches the repository/);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).summary.ok, true);
    assert.match(readFileSync(summary, 'utf8'), /✅ pass/);
    rmSync(dirname(out), { recursive: true, force: true });
  });

  it('exits 1 and names the rule on a broken repository', () => {
    const root = repo((r) => edit(r, 'Makefile', (s) => s.replace('cd backend', 'cd nowhere')));
    let status = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [CLI, '--repo-root', root], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
      });
    } catch (err) {
      status = err.status;
      stderr = err.stderr;
    }
    assert.equal(status, 1);
    assert.match(stderr, /\[make-cd-missing\] Makefile:5/);
  });

  it('prints the JSON report to stdout with --json', () => {
    const out = execFileSync(process.execPath, [CLI, '--repo-root', repo(), '--json'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
    });
    assert.equal(JSON.parse(out).summary.total, 0);
  });
});

function mkdirP(root, rel) {
  const p = join(root, rel);
  mkdirSync(p, { recursive: true });
  return p;
}

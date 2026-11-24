#!/usr/bin/env node
/**
 * check-clean-consumer-install.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests install resolution from a clean consumer project (issue #1223).
 *
 * #1212 (sdk-rc-smoke) proves a packed tarball is internally consistent when it
 * is extracted. It never *installs* it. What a real integrator experiences is
 * different: an empty project, `npm install <package>`, transitive dependency
 * resolution, peer dependencies, a hoisted or nested `node_modules`, and then
 * `require()` / `import` / TypeScript resolution against whatever landed there.
 *
 * This guard reproduces exactly that, hermetically:
 *   1. `pnpm pack` the publishable packages (pnpm rewrites `workspace:*` to the
 *      real version, exactly as `pnpm publish` does; `npm pack` would ship the
 *      unresolvable `workspace:*` specifier);
 *   2. write an empty consumer project whose dependencies are those tarballs
 *      (`overrides` keep transitive `@iln/*` deps on the local tarballs, so the
 *      test does not depend on what is — or is not — on the npm registry);
 *   3. `npm install` it from scratch;
 *   4. verify what the consumer would see.
 *
 * Checks (all fail closed; exit 1 on any finding):
 *   pack-failed         a package could not be built/packed, or has no dist/
 *   install-failed      `npm install` of the tarballs failed (unmet peer,
 *                       unresolvable specifier, missing transitive dependency)
 *   duplicate-copy      more than one installed copy of an SDK package — two
 *                       SDK instances means two `ILNError` classes, two caches
 *   peer-identity       a package that declares `@iln/sdk` as a peer resolves a
 *                       different file than the consumer's own `@iln/sdk`
 *   cjs-resolve         `require()` of an entry point failed
 *   esm-resolve         `import()` of an entry point failed
 *   symbol-missing      an entry point loads but lacks a required export
 *   types-unresolved    TypeScript cannot resolve an entry point's types to a
 *                       file inside the consumer's node_modules (or cannot run
 *                       at all — fail closed unless --skip-types)
 *
 * `@iln/react` is opt-in (`--include-react`) because its build has to be
 * healthy first; without the flag the report says so explicitly.
 *
 * Usage:
 *   node scripts/check-clean-consumer-install.mjs [--root=<dir>] [--json=<file>]
 *       [--work-dir=<dir>] [--no-build] [--force-build] [--include-react]
 *       [--skip-types] [--keep]
 *
 * See docs/runbooks/clean-consumer-install.md.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, '..');

/**
 * Packages installed into the consumer. `entries` are the runtime entry points
 * a consumer imports; `peerOnSdk` marks packages that must share the
 * consumer's `@iln/sdk` instead of nesting their own.
 */
export const TARGETS = Object.freeze([
  {
    pkg: '@iln/sdk',
    dir: 'sdk',
    entries: [
      {
        spec: '@iln/sdk',
        symbols: ['ILNSdk', 'ILN_TESTNET', 'createKeypairSigner', 'SDK_VERSION'],
      },
      { spec: '@iln/sdk/legacy', symbols: ['ILNSdk', 'ILN_TESTNET'] },
    ],
  },
  // Types-only package: no runtime entry, but sdk/react depend on it, so it has
  // to be installable and its types resolvable.
  { pkg: '@iln/shared', dir: 'packages/shared', entries: [], typesOnly: ['@iln/shared'] },
  {
    pkg: '@iln/react',
    dir: 'packages/react',
    optional: true,
    peerOnSdk: true,
    entries: [{ spec: '@iln/react', symbols: ['AmountDisplay', 'ILNProvider', 'useInvoice'] }],
  },
]);

/** Peer dependencies of the packages above that the consumer must provide. */
export const CONSUMER_PEERS = Object.freeze({
  react: '^19.0.0',
  'react-dom': '^19.0.0',
  '@tanstack/react-query': '^5.62.0',
});

const toPosix = (p) => p.split(sep).join('/');
const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: 'utf8', ...options });
const tail = (text, n = 12) =>
  String(text ?? '')
    .trim()
    .split('\n')
    .slice(-n)
    .join('\n');

export function selectTargets({ includeReact = false } = {}) {
  return TARGETS.filter((t) => !t.optional || includeReact);
}

/** The consumer's package.json: tarballs as dependencies, local overrides for transitive @iln/*. */
export function buildConsumerManifest({ tarballs, includeReact = false }) {
  const dependencies = {};
  const overrides = {};
  for (const { pkg, file } of tarballs) {
    dependencies[pkg] = `file:${toPosix(file)}`;
    overrides[pkg] = `$${pkg}`;
  }
  if (includeReact || tarballs.some((t) => t.pkg === '@iln/react')) {
    Object.assign(dependencies, CONSUMER_PEERS);
  }
  return {
    name: 'iln-clean-consumer',
    version: '0.0.0',
    private: true,
    dependencies,
    overrides,
  };
}

/** Every installed directory for `pkgName` under `<dir>/node_modules`, nested copies included. */
export function findPackageCopies(dir, pkgName) {
  const copies = [];
  const visit = (nodeModules) => {
    if (!existsSync(nodeModules)) return;
    for (const entry of readdirSync(nodeModules)) {
      if (entry === '.bin' || entry === '.package-lock.json') continue;
      const full = join(nodeModules, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      const scoped = entry.startsWith('@')
        ? readdirSync(full).map((s) => ({ name: `${entry}/${s}`, path: join(full, s) }))
        : [{ name: entry, path: full }];
      for (const pkg of scoped) {
        if (pkg.name === pkgName) copies.push(toPosix(relative(dir, pkg.path)));
        visit(join(pkg.path, 'node_modules'));
      }
    }
  };
  visit(join(dir, 'node_modules'));
  return copies.sort();
}

/** Wipe and recreate a consumer directory — a stale tree from a prior run must never leak in. */
export function prepareConsumerDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function probe(consumerDir, mode, spec) {
  const script =
    mode === 'cjs'
      ? `const m=require(${JSON.stringify(
          spec
        )});process.stdout.write(JSON.stringify(Object.keys(m)))`
      : `const m=await import(${JSON.stringify(
          spec
        )});process.stdout.write(JSON.stringify(Object.keys(m)))`;
  const args = mode === 'cjs' ? ['-e', script] : ['--input-type=module', '-e', script];
  // Silence the SDK's own migration warning: it is expected on @iln/sdk/legacy.
  const result = run(process.execPath, args, {
    cwd: consumerDir,
    env: { ...process.env, ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS: '1' },
  });
  if (result.status !== 0) return { ok: false, error: tail(result.stderr, 6) };
  try {
    return { ok: true, keys: new Set(JSON.parse(result.stdout)) };
  } catch {
    return { ok: false, error: `unparseable probe output: ${tail(result.stdout, 3)}` };
  }
}

/** Absolute path `fromFile` would resolve `spec` to using Node's CommonJS resolver. */
function resolveFrom(fromFile, spec) {
  try {
    return createRequire(fromFile).resolve(spec);
  } catch {
    return null;
  }
}

export function loadTypeScript(root) {
  for (const base of [join(root, 'sdk', 'package.json'), join(root, 'package.json')]) {
    try {
      return createRequire(base)('typescript');
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Verifies what a consumer sees after install. Pure with respect to `consumerDir`:
 * no network, no builds — it only reads the installed tree and spawns `node`.
 *
 * @returns {{ findings: object[], checks: object[] }}
 */
export function verifyConsumer(consumerDir, targets, { ts = null, skipTypes = false } = {}) {
  const findings = [];
  const checks = [];
  const add = (rule, file, message) => findings.push({ rule, file, message });

  // duplicate copies
  for (const target of targets) {
    const copies = findPackageCopies(consumerDir, target.pkg);
    checks.push({ check: 'copies', pkg: target.pkg, copies });
    if (copies.length === 0) {
      add(
        'install-failed',
        target.pkg,
        `${target.pkg} is not installed in the consumer's node_modules`
      );
    } else if (copies.length > 1) {
      add(
        'duplicate-copy',
        target.pkg,
        `${copies.length} installed copies of ${target.pkg}: ${copies.join(
          ', '
        )} — two instances at runtime`
      );
    }
  }

  // peer identity: packages that peer on @iln/sdk must share the consumer's copy
  const consumerFile = join(consumerDir, 'index.js');
  const sdkFromConsumer = resolveFrom(consumerFile, '@iln/sdk');
  for (const target of targets.filter((t) => t.peerOnSdk)) {
    const entryFile = join(consumerDir, 'node_modules', ...target.pkg.split('/'), 'index.js');
    const sdkFromPeer = resolveFrom(entryFile, '@iln/sdk');
    checks.push({
      check: 'peer-identity',
      pkg: target.pkg,
      sameInstance: Boolean(sdkFromConsumer && sdkFromConsumer === sdkFromPeer),
    });
    if (!sdkFromConsumer || sdkFromConsumer !== sdkFromPeer) {
      add(
        'peer-identity',
        target.pkg,
        `${target.pkg} resolves @iln/sdk to ${
          sdkFromPeer ? toPosix(relative(consumerDir, sdkFromPeer)) : '<unresolvable>'
        } but the consumer resolves ${
          sdkFromConsumer ? toPosix(relative(consumerDir, sdkFromConsumer)) : '<unresolvable>'
        }`
      );
    }
  }

  // runtime entry points, CJS + ESM
  for (const target of targets) {
    for (const { spec, symbols } of target.entries) {
      for (const mode of ['cjs', 'esm']) {
        const result = probe(consumerDir, mode, spec);
        checks.push({ check: mode, spec, ok: result.ok });
        if (!result.ok) {
          add(
            `${mode}-resolve`,
            spec,
            `${mode === 'cjs' ? 'require' : 'import'}("${spec}") failed: ${result.error}`
          );
          continue;
        }
        const missing = symbols.filter((s) => !result.keys.has(s));
        if (missing.length > 0) {
          add('symbol-missing', spec, `${mode} ${spec} is missing exports: ${missing.join(', ')}`);
        }
      }
    }
  }

  // TypeScript resolution
  if (!skipTypes) {
    const specs = targets.flatMap((t) => [...t.entries.map((e) => e.spec), ...(t.typesOnly ?? [])]);
    if (specs.length > 0 && !ts) {
      add(
        'types-unresolved',
        'typescript',
        'typescript is not installed, so type resolution cannot be verified (use --skip-types to opt out)'
      );
    } else {
      const nodeModulesRoot = join(consumerDir, 'node_modules') + sep;
      for (const spec of specs) {
        for (const moduleResolution of [
          ts.ModuleResolutionKind.Bundler,
          ts.ModuleResolutionKind.Node16,
        ]) {
          const { resolvedModule } = ts.resolveModuleName(
            spec,
            join(consumerDir, 'index.mts'),
            {
              moduleResolution,
              module:
                moduleResolution === ts.ModuleResolutionKind.Node16
                  ? ts.ModuleKind.Node16
                  : ts.ModuleKind.ESNext,
            },
            ts.sys
          );
          const file = resolvedModule?.resolvedFileName;
          const inside = Boolean(
            file &&
              /\.d\.[cm]?ts$/.test(file) &&
              file.startsWith(nodeModulesRoot) &&
              existsSync(file)
          );
          checks.push({
            check: 'types',
            spec,
            moduleResolution: ts.ModuleResolutionKind[moduleResolution],
            ok: inside,
          });
          if (!inside) {
            add(
              'types-unresolved',
              spec,
              `TypeScript (${ts.ModuleResolutionKind[moduleResolution]}) resolved "${spec}" to ${
                file ? toPosix(relative(consumerDir, file)) : '<nothing>'
              }, expected a .d.ts inside the consumer's node_modules`
            );
          }
        }
      }
    }
  }

  return { findings, checks };
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Pack every target; returns tarballs and findings. */
function packTargets(root, targets, workDir, { build, forceBuild }) {
  const findings = [];
  const tarballs = [];
  const dest = join(workDir, 'tarballs');
  mkdirSync(dest, { recursive: true });
  for (const target of targets) {
    const dir = join(root, target.dir);
    if (!existsSync(join(dir, 'package.json'))) {
      findings.push({
        rule: 'pack-failed',
        file: target.dir,
        message: `${target.dir}/package.json is missing`,
      });
      continue;
    }
    if (build && (forceBuild || !existsSync(join(dir, 'dist')))) {
      const built = run('pnpm', ['--filter', target.pkg, 'build'], { cwd: root, stdio: 'inherit' });
      if (built.status !== 0) {
        findings.push({
          rule: 'pack-failed',
          file: target.pkg,
          message: `pnpm --filter ${target.pkg} build exited ${built.status}`,
        });
        continue;
      }
    }
    if (!existsSync(join(dir, 'dist'))) {
      findings.push({
        rule: 'pack-failed',
        file: target.pkg,
        message: `${target.dir}/dist is missing — build it first (or drop --no-build)`,
      });
      continue;
    }
    const packed = run('pnpm', ['pack', '--pack-destination', dest], { cwd: dir });
    const name = tail(packed.stdout, 1).split('/').pop();
    const file = name && join(dest, name);
    if (packed.status !== 0 || !file || !existsSync(file)) {
      findings.push({
        rule: 'pack-failed',
        file: target.pkg,
        message: `pnpm pack failed: ${tail(packed.stderr || packed.stdout, 6)}`,
      });
      continue;
    }
    tarballs.push({
      pkg: target.pkg,
      file: `../tarballs/${name}`,
      abs: file,
      bytes: statSync(file).size,
      sha256: sha256(file),
    });
  }
  return { tarballs, findings };
}

/**
 * Full run: pack → clean consumer → npm install → verify.
 */
export function checkCleanConsumer(root, options = {}) {
  const {
    workDir = mkdtempSync(join(tmpdir(), 'iln-clean-consumer-')),
    build = true,
    forceBuild = false,
    includeReact = false,
    skipTypes = false,
    keep = false,
  } = options;
  const targets = selectTargets({ includeReact });
  const findings = [];
  const report = {
    environment: {
      node: process.version,
      npm: tail(run('npm', ['--version']).stdout, 1),
      pnpm: tail(run('pnpm', ['--version']).stdout, 1),
    },
    includeReact,
    skipped: includeReact ? [] : ['@iln/react (pass --include-react once its build is healthy)'],
    tarballs: [],
    checks: [],
  };

  try {
    mkdirSync(workDir, { recursive: true });
    const { tarballs, findings: packFindings } = packTargets(root, targets, workDir, {
      build,
      forceBuild,
    });
    findings.push(...packFindings);
    report.tarballs = tarballs.map(({ pkg, bytes, sha256: digest }) => ({
      pkg,
      bytes,
      sha256: digest,
    }));
    if (packFindings.length === 0) {
      const consumerDir = prepareConsumerDir(join(workDir, 'consumer'));
      writeFileSync(
        join(consumerDir, 'package.json'),
        JSON.stringify(buildConsumerManifest({ tarballs, includeReact }), null, 2) + '\n'
      );
      const started = Date.now();
      const install = run(
        'npm',
        [
          'install',
          '--no-audit',
          '--no-fund',
          '--ignore-scripts',
          '--package-lock=false',
          '--loglevel=error',
        ],
        { cwd: consumerDir }
      );
      report.installMs = Date.now() - started;
      if (install.status !== 0) {
        findings.push({
          rule: 'install-failed',
          file: 'consumer/package.json',
          message: `npm install exited ${install.status}: ${tail(
            install.stderr || install.stdout,
            8
          )}`,
        });
      } else {
        const verified = verifyConsumer(consumerDir, targets, {
          ts: skipTypes ? null : loadTypeScript(root),
          skipTypes,
        });
        findings.push(...verified.findings);
        report.checks = verified.checks;
      }
    }
  } finally {
    if (!keep) rmSync(workDir, { recursive: true, force: true });
  }

  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  return {
    ...report,
    summary: { ok: findings.length === 0, total: findings.length, byRule },
    findings,
  };
}

function parseArgs(argv) {
  const args = {
    root: null,
    json: null,
    workDir: undefined,
    build: true,
    forceBuild: false,
    includeReact: false,
    skipTypes: false,
    keep: false,
  };
  for (const a of argv) {
    if (a.startsWith('--root=')) args.root = a.slice(7);
    else if (a.startsWith('--json=')) args.json = a.slice(7);
    else if (a.startsWith('--work-dir=')) args.workDir = resolve(a.slice(11));
    else if (a === '--no-build') args.build = false;
    else if (a === '--force-build') args.forceBuild = true;
    else if (a === '--include-react') args.includeReact = true;
    else if (a === '--skip-types') args.skipTypes = true;
    else if (a === '--keep') args.keep = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root ?? DEFAULT_ROOT);
  const report = checkCleanConsumer(root, args);

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2) + '\n'
    );
  }
  for (const f of report.findings) {
    console.log(`::error file=${f.file}::[${f.rule}] ${f.message}`);
  }
  const names = report.tarballs.map((t) => t.pkg).join(', ') || 'nothing';
  console.log(
    report.summary.ok
      ? `clean-consumer-install: OK — ${names} install into an empty project and resolve (CJS, ESM, types).`
      : `clean-consumer-install: FAIL — ${report.summary.total} finding(s) ${JSON.stringify(
          report.summary.byRule
        )}. See docs/runbooks/clean-consumer-install.md.`
  );
  for (const s of report.skipped) console.log(`clean-consumer-install: skipped ${s}`);
  process.exitCode = report.summary.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

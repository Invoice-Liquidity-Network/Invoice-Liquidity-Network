#!/usr/bin/env node
/**
 * check-react-sdk-imports.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Aligns `@iln/react`'s imports with the canonical SDK (issue #1221).
 *
 * `@iln/react` consumes the stable SDK (`sdk/` → `@iln/sdk`) as a *peer*
 * dependency. #1213 guards the peer ranges and #1218 guards the package names;
 * neither looks at what `packages/react/src` actually imports. This guard
 * closes that gap.
 *
 * Checks (all error-level, exit 1 on any finding), over `packages/react/src`
 * (tests included — a test that imports a different SDK than production code
 * proves nothing):
 *   1. react-sdk-specifier   SDK imports use the bare canonical `@iln/sdk`
 *                            entry. No `@iln/sdk-next` (experimental, different
 *                            API, would load a second SDK), no deep import
 *                            (`@iln/sdk/dist/...`, `@iln/sdk/legacy` — the
 *                            deprecated shim), no relative path into `sdk/`
 *                            or `packages/sdk/` (bundles a private copy).
 *   2. react-undeclared-import  every `@iln/*` package imported is declared in
 *                            packages/react/package.json (dependencies,
 *                            peerDependencies or devDependencies). An
 *                            undeclared import only resolves through hoisting
 *                            and breaks the published package's `.d.ts`.
 *   3. react-sdk-missing-export  every named import from `@iln/sdk` exists in
 *                            the SDK's public surface (`sdk/src/index.ts`,
 *                            resolved through its re-exports). This is the
 *                            regression the type-check job would otherwise be
 *                            the only line of defence for, and it runs without
 *                            building the SDK. If the export graph cannot be
 *                            resolved (an `export *` from a bare package) the
 *                            rule fails closed rather than skipping.
 *
 * A line carrying `sdk-name-check: allow-legacy` is exempt.
 *
 * Usage:
 *   node scripts/check-react-sdk-imports.mjs [--root=<dir>] [--json=<file>]
 *
 * See docs/runbooks/react-sdk-imports.md.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOW_PRAGMA,
  declaredDependencies,
  extractSpecifiers,
  packageNameOf,
  readJson,
  relPosix,
  sortFindings,
  summarize,
  walkFiles,
} from './lib/sdk-surface.mjs';

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const CANONICAL_SDK = '@iln/sdk';

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '');
}

function resolveModuleFile(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Names exported by a TypeScript module, following relative re-exports.
 * @returns {{ names: Set<string>, unresolved: string[] }}
 */
export function collectExports(entryFile, seen = new Set()) {
  const names = new Set();
  const unresolved = [];
  if (seen.has(entryFile)) return { names, unresolved };
  seen.add(entryFile);
  const text = stripComments(readFileSync(entryFile, 'utf8'));

  // export * from '...' / export * as ns from '...'
  for (const m of text.matchAll(
    /export\s+\*\s+(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s+['"]([^'"]+)['"]/g
  )) {
    if (m[1]) {
      names.add(m[1]);
      continue;
    }
    const spec = m[2];
    const target = spec.startsWith('.') ? resolveModuleFile(entryFile, spec) : null;
    if (!target) {
      unresolved.push(`${entryFile}: export * from '${spec}'`);
      continue;
    }
    const sub = collectExports(target, seen);
    sub.names.forEach((n) => names.add(n));
    unresolved.push(...sub.unresolved);
  }

  // export { a, b as c } [from '...'] / export type { ... } [from '...']
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const item = part.trim().replace(/^type\s+/, '');
      if (!item) continue;
      const alias = item.split(/\s+as\s+/);
      names.add((alias[1] ?? alias[0]).trim());
    }
  }

  // export [declare] [abstract] <kind> Name
  for (const m of text.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+enum|enum|const|let|var|function\*?|class|interface|type|namespace)\s+([A-Za-z_$][\w$]*)/g
  )) {
    names.add(m[1]);
  }
  return { names, unresolved };
}

/** Named bindings of `import { a, type B as C } from '<spec>'` (multi-line aware). */
function namedImports(text, spec) {
  const out = [];
  const re = new RegExp(
    `import\\s+(?:type\\s+)?(?:[A-Za-z_$][\\w$]*\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${spec.replace(
      /[.*+?^${}()|[\]\\/]/g,
      '\\$&'
    )}['"]`,
    'g'
  );
  for (const m of text.matchAll(re)) {
    const before = text.slice(0, m.index);
    const line = before.split('\n').length;
    for (const part of m[1].split(',')) {
      const item = part.trim().replace(/^type\s+/, '');
      if (!item) continue;
      out.push({ name: item.split(/\s+as\s+/)[0].trim(), line });
    }
  }
  return out;
}

/**
 * @param {string} root repository root
 */
export function checkReactImports(root) {
  const findings = [];
  const add = (f) => findings.push(f);
  const reactDir = join(root, 'packages', 'react');
  const manifestPath = join(reactDir, 'package.json');
  const sdkEntry = join(root, 'sdk', 'src', 'index.ts');

  if (!existsSync(manifestPath)) {
    add({
      rule: 'react-undeclared-import',
      file: 'packages/react/package.json',
      message: 'file is missing',
    });
    return { summary: summarize(findings), findings, files: 0, sdkExports: 0 };
  }
  const declared = declaredDependencies(readJson(manifestPath));

  let sdkExports = null;
  if (!existsSync(sdkEntry)) {
    add({
      rule: 'react-sdk-missing-export',
      file: 'sdk/src/index.ts',
      message: 'SDK entry is missing',
    });
  } else {
    const { names, unresolved } = collectExports(sdkEntry);
    if (unresolved.length > 0) {
      add({
        rule: 'react-sdk-missing-export',
        file: 'sdk/src/index.ts',
        message: `cannot resolve the SDK export graph (fail closed): ${unresolved.join('; ')}`,
      });
    } else {
      sdkExports = names;
    }
  }

  const files = walkFiles(join(reactDir, 'src'), SOURCE_EXTS);
  for (const file of files) {
    const rel = relPosix(root, file);
    const text = readFileSync(file, 'utf8');

    for (const imp of extractSpecifiers(text)) {
      if (imp.text.includes(ALLOW_PRAGMA)) continue;
      const loc = { file: rel, line: imp.line, column: imp.column };

      // 1. specifier shape
      if (imp.spec.startsWith('.')) {
        const target = relPosix(root, resolve(dirname(file), imp.spec));
        if (/^(?:packages\/)?sdk(?:\/|$)/.test(target)) {
          add({
            ...loc,
            rule: 'react-sdk-specifier',
            message: `relative import "${imp.spec}" reaches into an SDK directory — import "${CANONICAL_SDK}" instead`,
          });
        }
        continue;
      }
      const pkg = packageNameOf(imp.spec);
      if (!pkg) continue;
      if (pkg === '@iln/sdk-next') {
        add({
          ...loc,
          rule: 'react-sdk-specifier',
          message: `"${imp.spec}" is the experimental SDK; @iln/react is built on "${CANONICAL_SDK}"`,
        });
      } else if (pkg === CANONICAL_SDK && imp.spec !== CANONICAL_SDK) {
        add({
          ...loc,
          rule: 'react-sdk-specifier',
          message: `deep import "${imp.spec}" — use the bare "${CANONICAL_SDK}" entry (subpaths such as /legacy are deprecated)`,
        });
      }

      // 2. declared
      if (pkg.startsWith('@iln/') && !declared.has(pkg)) {
        add({
          ...loc,
          rule: 'react-undeclared-import',
          message: `imports "${pkg}" but packages/react/package.json does not declare it`,
        });
      }
    }

    // 3. named imports exist in the SDK public surface
    if (sdkExports) {
      for (const { name, line } of namedImports(text, CANONICAL_SDK)) {
        if (!sdkExports.has(name)) {
          add({
            file: rel,
            line,
            rule: 'react-sdk-missing-export',
            message: `"${name}" is imported from "${CANONICAL_SDK}" but sdk/src/index.ts does not export it`,
          });
        }
      }
    }
  }

  sortFindings(findings);
  return {
    files: files.length,
    sdkExports: sdkExports ? sdkExports.size : 0,
    summary: summarize(findings),
    findings,
  };
}

function parseArgs(argv) {
  const args = { root: null, json: null };
  for (const a of argv) {
    if (a.startsWith('--root=')) args.root = a.slice(7);
    else if (a.startsWith('--json=')) args.json = a.slice(7);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const report = checkReactImports(root);

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2) + '\n'
    );
  }
  for (const f of report.findings) {
    console.log(
      `::error file=${f.file}${f.line ? `,line=${f.line}` : ''}::[${f.rule}] ${f.message}`
    );
    if (!process.env.GITHUB_ACTIONS) console.log(`  ${f.file}${f.line ? `:${f.line}` : ''}`);
  }
  const { total, filesWithFindings, byRule } = report.summary;
  console.log(
    report.summary.ok
      ? `react-sdk-imports: OK — ${report.files} @iln/react files import only the canonical ${CANONICAL_SDK} (${report.sdkExports} public exports).`
      : `react-sdk-imports: FAIL — ${total} finding(s) in ${filesWithFindings} file(s) ${JSON.stringify(
          byRule
        )}. See docs/runbooks/react-sdk-imports.md.`
  );
  process.exitCode = report.summary.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

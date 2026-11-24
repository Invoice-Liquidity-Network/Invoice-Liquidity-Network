#!/usr/bin/env node
/**
 * check-example-package-names.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Aligns package names across every SDK example (issue #1220).
 *
 * #1218 pinned the manifests (`sdk/` → @iln/sdk, `packages/sdk/` → @iln/sdk-next)
 * and #1214 checked that the examples resolve `@iln/sdk`. Neither looks at what
 * the examples actually *say*: the imports in their source files, the package
 * names in their READMEs, or whether the install command in the README can
 * install the dependency specifier in the manifest.
 *
 * Checks (all error-level, exit 1 on any finding), over `examples/**`:
 *   1. example-unknown-package   an `@iln/<name>` token in a source file, README
 *                                or manifest that is not a real workspace
 *                                package (typos, retired names such as
 *                                `@iln/skd`, `@iln/sdk-core`).
 *   2. example-undeclared-import a source file imports `@iln/*` that its own
 *                                package.json does not declare — it only
 *                                resolves by accident of hoisting, or not at all.
 *   3. example-install-protocol  the manifest uses the pnpm-only `workspace:`
 *                                protocol but the README tells readers to run
 *                                `npm install` / `yarn install`, which fails
 *                                with EUNSUPPORTEDPROTOCOL.
 *
 * A line carrying `sdk-name-check: allow-legacy` is exempt (migration docs).
 *
 * Usage:
 *   node scripts/check-example-package-names.mjs [--root=<dir>] [--json=<file>]
 *
 * See docs/runbooks/example-package-names.md.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOW_PRAGMA,
  declaredDependencies,
  extractIlnTokens,
  extractSpecifiers,
  listWorkspacePackages,
  packageNameOf,
  readJson,
  relPosix,
  sortFindings,
  summarize,
  walkFiles,
} from './lib/sdk-surface.mjs';

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const TEXT_EXTS = [...SOURCE_EXTS, '.md', '.mdx', '.json', '.html'];

/** `npm install` / `yarn install` with no package argument — a project install. */
const NPM_PROJECT_INSTALL = /^\s*(?:RUN\s+)?(?:npm\s+(?:install|i|ci)|yarn(?:\s+install)?)\s*$/;

/**
 * @param {string} root repository root
 * @returns {{ findings: object[], summary: object, examples: string[] }}
 */
export function checkExamples(root) {
  const findings = [];
  const add = (f) => findings.push(f);
  const workspace = listWorkspacePackages(root);
  const examplesDir = join(root, 'examples');
  const exampleDirs = existsSync(examplesDir)
    ? readdirSync(examplesDir)
        .filter((e) => statSync(join(examplesDir, e)).isDirectory())
        .sort()
    : [];

  for (const name of exampleDirs) {
    const dir = join(examplesDir, name);
    const manifestPath = join(dir, 'package.json');
    let manifest = null;
    if (existsSync(manifestPath)) {
      try {
        manifest = readJson(manifestPath);
      } catch (err) {
        add({
          rule: 'example-unknown-package',
          file: relPosix(root, manifestPath),
          message: `package.json is not valid JSON: ${err.message}`,
        });
      }
    }
    const declared = manifest ? declaredDependencies(manifest) : new Set();
    const usesWorkspaceProtocol = manifest
      ? ['dependencies', 'devDependencies', 'peerDependencies'].some((k) =>
          Object.values(manifest[k] ?? {}).some((v) => String(v).startsWith('workspace:'))
        )
      : false;

    for (const file of walkFiles(dir, TEXT_EXTS)) {
      const rel = relPosix(root, file);
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');

      // 1. every @iln/<x> token must be a real workspace package
      for (const tok of extractIlnTokens(text)) {
        if (tok.text.includes(ALLOW_PRAGMA)) continue;
        if (workspace.has(tok.name)) continue;
        add({
          rule: 'example-unknown-package',
          file: rel,
          line: tok.line,
          column: tok.column,
          message: `"${tok.name}" is not a workspace package (known: ${[...workspace.keys()]
            .filter((n) => n.startsWith('@iln/'))
            .sort()
            .join(', ')})`,
        });
      }

      // 2. imports must be declared by the example's own manifest
      if (SOURCE_EXTS.some((ext) => file.endsWith(ext))) {
        for (const imp of extractSpecifiers(text)) {
          const pkg = packageNameOf(imp.spec);
          if (!pkg || !pkg.startsWith('@iln/') || imp.text.includes(ALLOW_PRAGMA)) continue;
          if (!declared.has(pkg)) {
            add({
              rule: 'example-undeclared-import',
              file: rel,
              line: imp.line,
              column: imp.column,
              message: manifest
                ? `imports "${pkg}" but examples/${name}/package.json does not declare it`
                : `imports "${pkg}" but examples/${name}/ has no package.json`,
            });
          }
        }
      }

      // 3. README install command must be able to install the manifest
      if (usesWorkspaceProtocol && file.endsWith('README.md')) {
        lines.forEach((lineText, idx) => {
          if (NPM_PROJECT_INSTALL.test(lineText) && !lineText.includes(ALLOW_PRAGMA)) {
            add({
              rule: 'example-install-protocol',
              file: rel,
              line: idx + 1,
              message:
                `README runs \`${lineText.trim()}\` but examples/${name}/package.json uses the ` +
                'pnpm-only `workspace:` protocol (npm fails with EUNSUPPORTEDPROTOCOL) — use `pnpm install`',
            });
          }
        });
      }
    }
  }

  sortFindings(findings);
  return { examples: exampleDirs, summary: summarize(findings), findings };
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
  const report = checkExamples(root);

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
      ? `example-package-names: OK — ${report.examples.length} examples use only real workspace package names.`
      : `example-package-names: FAIL — ${total} finding(s) in ${filesWithFindings} file(s) ${JSON.stringify(
          byRule
        )}. See docs/runbooks/example-package-names.md.`
  );
  process.exitCode = report.summary.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

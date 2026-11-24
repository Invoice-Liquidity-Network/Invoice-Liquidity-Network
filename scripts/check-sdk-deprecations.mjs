#!/usr/bin/env node
/**
 * check-sdk-deprecations.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Keeps the deprecated-SDK-surface migration warnings alive (issue #1222).
 *
 * The runtime control is `sdk/src/deprecation.ts` (`warnDeprecated`), called by
 * the deprecated entry points. A warning that nobody can see, nobody tests or
 * nobody documented is not a control, and one that a bundler tree-shakes away
 * is silently gone. This guard makes each of those a CI failure.
 *
 * For every notice declared in `DEPRECATION_NOTICES`:
 *   1. notice-not-wired      some non-test SDK source calls `warnDeprecated('<id>')`.
 *   2. notice-untested       a `*.test.ts` under sdk/src references the notice id.
 *   3. notice-undocumented   docs/sdk-migration-guide.md has the heading the
 *                            notice's `docs` anchor points at, and mentions the
 *                            notice's `code` and the suppression env var.
 *   4. side-effects-dropped  a module that warns at load time (a top-level
 *                            `warnDeprecated(...)` call) has its built
 *                            `dist/<name>.mjs|cjs` listed in sdk/package.json
 *                            `sideEffects` — with `"sideEffects": false` a
 *                            bundler may drop the module's warning.
 *   5. notice-uncatalogued   `warnDeprecated('<id>')` is called with an id that
 *                            is not in the registry (it would silently no-op).
 *
 * Usage:
 *   node scripts/check-sdk-deprecations.mjs [--root=<dir>] [--json=<file>]
 *
 * See docs/runbooks/sdk-deprecations.md.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, relPosix, sortFindings, summarize, walkFiles } from './lib/sdk-surface.mjs';

const SUPPRESS_ENV = 'ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS';

/** GitHub-style heading slug. */
export function slugify(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** Notices declared in sdk/src/deprecation.ts → [{ id, code, docs }]. */
export function parseNotices(source) {
  const notices = [];
  const re = /id:\s*'([^']+)'[\s\S]*?code:\s*'([^']+)'[\s\S]*?docs:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(source)) !== null) notices.push({ id: m[1], code: m[2], docs: m[3] });
  return notices;
}

export function checkSdkDeprecations(root) {
  const findings = [];
  const add = (f) => findings.push(f);
  const registryFile = join(root, 'sdk', 'src', 'deprecation.ts');
  const guideFile = join(root, 'docs', 'sdk-migration-guide.md');
  const manifestFile = join(root, 'sdk', 'package.json');

  if (!existsSync(registryFile)) {
    add({
      rule: 'notice-not-wired',
      file: 'sdk/src/deprecation.ts',
      message: 'deprecation registry is missing',
    });
    return { notices: [], summary: summarize(findings), findings };
  }
  const notices = parseNotices(readFileSync(registryFile, 'utf8'));
  if (notices.length === 0) {
    add({
      rule: 'notice-not-wired',
      file: 'sdk/src/deprecation.ts',
      message: 'DEPRECATION_NOTICES declares no notices',
    });
  }

  const srcFiles = walkFiles(join(root, 'sdk', 'src'), ['.ts']);
  const sources = srcFiles.map((f) => ({
    rel: relPosix(root, f),
    text: readFileSync(f, 'utf8'),
    isTest: /\.test\.ts$/.test(f),
    isRegistry: f === registryFile,
  }));

  const calls = [];
  for (const s of sources) {
    if (s.isTest || s.isRegistry) continue;
    s.text.split('\n').forEach((line, idx) => {
      const m = /\bwarnDeprecated\(\s*'([^']+)'/.exec(line);
      if (m)
        calls.push({
          id: m[1],
          file: s.rel,
          line: idx + 1,
          topLevel: /^warnDeprecated\(/.test(line),
        });
    });
  }

  const guide = existsSync(guideFile) ? readFileSync(guideFile, 'utf8') : '';
  const headings = new Set(
    guide
      .split('\n')
      .filter((l) => /^#{1,6}\s/.test(l))
      .map((l) => slugify(l.replace(/^#{1,6}\s+/, '').replace(/<!--.*?-->/g, '')))
  );

  let sideEffects;
  try {
    sideEffects = readJson(manifestFile).sideEffects;
  } catch {
    sideEffects = undefined;
  }

  const known = new Set(notices.map((n) => n.id));
  for (const call of calls) {
    if (!known.has(call.id)) {
      add({
        rule: 'notice-uncatalogued',
        file: call.file,
        line: call.line,
        message: `warnDeprecated('${call.id}') is not in DEPRECATION_NOTICES, so it never warns`,
      });
    }
  }

  for (const notice of notices) {
    const callSites = calls.filter((c) => c.id === notice.id);
    if (callSites.length === 0) {
      add({
        rule: 'notice-not-wired',
        file: 'sdk/src/deprecation.ts',
        message: `notice '${notice.id}' is declared but no SDK source calls warnDeprecated('${notice.id}')`,
      });
    }

    if (
      !sources.some(
        (s) => s.isTest && (s.text.includes(`'${notice.id}'`) || s.text.includes(notice.code))
      )
    ) {
      add({
        rule: 'notice-untested',
        file: 'sdk/src',
        message: `no test under sdk/src references notice '${notice.id}' or ${notice.code}`,
      });
    }

    const [docPath, anchor] = notice.docs.split('#');
    if (docPath !== 'docs/sdk-migration-guide.md' || !anchor || !headings.has(anchor)) {
      add({
        rule: 'notice-undocumented',
        file: 'docs/sdk-migration-guide.md',
        message: `notice '${notice.id}' points at ${notice.docs}, but that heading does not exist`,
      });
    }
    if (!guide.includes(notice.code)) {
      add({
        rule: 'notice-undocumented',
        file: 'docs/sdk-migration-guide.md',
        message: `migration guide does not mention ${notice.code}, the code operators will see in their logs`,
      });
    }

    for (const site of callSites.filter((c) => c.topLevel)) {
      const entry = basename(site.file, '.ts');
      const needed = [`./dist/${entry}.mjs`, `./dist/${entry}.cjs`];
      const listed = Array.isArray(sideEffects) ? sideEffects : [];
      const missing = needed.filter((n) => !listed.includes(n));
      if (missing.length > 0) {
        add({
          rule: 'side-effects-dropped',
          file: 'sdk/package.json',
          message: `${site.file} warns at module load but sideEffects ${JSON.stringify(
            sideEffects ?? null
          )} does not list ${missing.join(', ')} — bundlers may drop the warning`,
        });
      }
    }
  }
  if (notices.length > 0 && !guide.includes(SUPPRESS_ENV)) {
    add({
      rule: 'notice-undocumented',
      file: 'docs/sdk-migration-guide.md',
      message: `migration guide does not document ${SUPPRESS_ENV}`,
    });
  }

  sortFindings(findings);
  return { notices: notices.map((n) => n.id), summary: summarize(findings), findings };
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
  const report = checkSdkDeprecations(root);
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
  }
  const { total, byRule } = report.summary;
  console.log(
    report.summary.ok
      ? `sdk-deprecations: OK — ${
          report.notices.length
        } migration notice(s) wired, tested, documented: ${report.notices.join(', ')}.`
      : `sdk-deprecations: FAIL — ${total} finding(s) ${JSON.stringify(
          byRule
        )}. See docs/runbooks/sdk-deprecations.md.`
  );
  process.exitCode = report.summary.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

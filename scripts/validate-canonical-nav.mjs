#!/usr/bin/env node
/**
 * scripts/validate-canonical-nav.mjs
 *
 * Parse-validates every `_meta.ts` under the canonical docs site
 * (`packages/docs/content/`) — see scripts/lib/docs-nav.mjs (#1284).
 *
 * Usage:
 *   node scripts/validate-canonical-nav.mjs [--content-dir <path>] [--json]
 *
 * Exit codes:
 *   0 — every _meta file parses and matches the file tree
 *   1 — parse, schema, duplicate, orphaned or undiscoverable errors (CI fails)
 *
 * When GITHUB_STEP_SUMMARY is set, a summary table is appended so the CI run
 * shows the control ran and what it checked.
 */

import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatError, validateContentTree } from './lib/docs-nav.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirIndex = args.indexOf('--content-dir');
const contentRoot =
  dirIndex >= 0 && args[dirIndex + 1]
    ? resolve(process.cwd(), args[dirIndex + 1])
    : resolve(repoRoot, 'packages', 'docs', 'content');

const report = validateContentTree(contentRoot);
const ok = report.errors.length === 0;

if (args.includes('--json')) {
  console.log(JSON.stringify({ contentRoot, ok, ...report }, null, 2));
} else {
  console.log(`Validating canonical docs navigation in: ${contentRoot}\n`);
  for (const error of report.errors) console.error(`  ✗ ${formatError(error, repoRoot)}`);
  if (ok) {
    console.log(`✓ ${report.metaFiles} _meta file(s), ${report.entries} entries: all valid.`);
  } else {
    console.error(
      `\n✗ ${report.errors.length} navigation error(s) across ${report.metaFiles} _meta file(s).`
    );
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### Canonical docs navigation (`packages/docs/content/**/_meta.ts`)',
    '',
    `| _meta files | entries | errors |`,
    `|---|---|---|`,
    `| ${report.metaFiles} | ${report.entries} | ${report.errors.length} |`,
    '',
    ...report.errors.map((error) => `- \`${formatError(error, repoRoot)}\``),
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

process.exit(ok ? 0 : 1);

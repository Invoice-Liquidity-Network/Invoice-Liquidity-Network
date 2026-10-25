#!/usr/bin/env node
/**
 * scripts/check-docs-migration.mjs
 *
 * Verifies the canonical docs migration checklist in docs/DOCS_SETUP.md
 * against the repository — see scripts/lib/docs-migration.mjs (#1283).
 *
 * Usage:
 *   node scripts/check-docs-migration.mjs [--repo-root <path>] [--json]
 *
 * Exit codes:
 *   0 — checklist parses, every ticked page is ported and in the canonical
 *       nav, and every legacy page is tracked
 *   1 — parse error or checklist out of sync with the repository
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChecklistParseError, parseChecklist, validateChecklist } from './lib/docs-migration.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--repo-root');
const repoRoot =
  rootIndex >= 0 && args[rootIndex + 1]
    ? resolve(process.cwd(), args[rootIndex + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checklistPath = join(repoRoot, 'docs', 'DOCS_SETUP.md');

let result;
try {
  result = validateChecklist(parseChecklist(readFileSync(checklistPath, 'utf8')), repoRoot);
} catch (err) {
  if (!(err instanceof ChecklistParseError)) throw err;
  result = { summary: null, errors: [{ line: err.line, message: err.reason }] };
}

const ok = result.errors.length === 0;
const where = (line) => (line ? `docs/DOCS_SETUP.md:${line}` : 'docs/');

if (args.includes('--json')) {
  console.log(JSON.stringify({ ok, ...result }, null, 2));
} else {
  for (const error of result.errors) console.error(`  ✗ ${where(error.line)} ${error.message}`);
  if (result.summary) {
    const { ported, pending, excluded, tracked, cleanupDone, cleanupTotal } = result.summary;
    console.log(
      `Docs migration: ${ported}/${ported + pending} pages ported, ${excluded} excluded, ` +
        `${tracked} legacy pages tracked, cleanup ${cleanupDone}/${cleanupTotal}.`
    );
  }
  console.log(
    ok
      ? '✓ Migration checklist is in sync with the repository.'
      : '\n✗ Migration checklist is out of sync.'
  );
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const s = result.summary;
  const lines = [
    '### Canonical docs migration checklist (`docs/DOCS_SETUP.md`)',
    '',
    ...(s
      ? [
          '| ported | pending | excluded | cleanup | errors |',
          '|---|---|---|---|---|',
          `| ${s.ported} | ${s.pending} | ${s.excluded} | ${s.cleanupDone}/${s.cleanupTotal} | ${result.errors.length} |`,
        ]
      : ['Checklist failed to parse.']),
    '',
    ...result.errors.map((error) => `- \`${where(error.line)}\` ${error.message}`),
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

process.exit(ok ? 0 : 1);

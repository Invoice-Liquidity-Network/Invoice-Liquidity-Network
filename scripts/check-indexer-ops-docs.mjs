#!/usr/bin/env node
/**
 * scripts/check-indexer-ops-docs.mjs
 *
 * Executable checks for the indexer operations documentation (#1288): every
 * environment variable, default, endpoint, metric, command and Railway setting
 * that docs/indexer/*.md claims is verified against the indexer source.
 * See scripts/lib/indexer-ops-docs.mjs and docs/indexer/operations-checks.md.
 *
 * Usage:
 *   node scripts/check-indexer-ops-docs.mjs [--repo-root <path>] [--json[=<file>]]
 *
 * Exit codes:
 *   0 — documentation matches the indexer
 *   1 — at least one documented claim is not backed by the code
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIndexerOpsDocs } from './lib/indexer-ops-docs.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--repo-root');
const repoRoot =
  rootIndex >= 0 && args[rootIndex + 1]
    ? resolve(process.cwd(), args[rootIndex + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsonArg = args.find((a) => a === '--json' || a.startsWith('--json='));

const result = checkIndexerOpsDocs(repoRoot);
const { findings, summary } = result;
const where = (f) => (f.line ? `${f.file}:${f.line}` : f.file);

if (jsonArg === '--json') {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (jsonArg) writeFileSync(jsonArg.slice('--json='.length), JSON.stringify(result, null, 2));
  for (const f of findings) console.error(`  ✗ [${f.rule}] ${where(f)} ${f.message}`);
  console.log(
    `Indexer ops docs: ${summary.docsScanned} docs, ${summary.envVarsRead} env vars read / ` +
      `${summary.envVarsDocumented} documented, ${summary.routeRefs} endpoint, ` +
      `${summary.metricRefs} metric and ${summary.commandRefs} command references checked.`
  );
  console.log(
    summary.ok
      ? '✓ Indexer operations docs match the code.'
      : `\n✗ ${summary.total} documented claim(s) are not backed by the indexer. See docs/indexer/operations-checks.md.`
  );
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### Indexer operations docs (`docs/indexer/`)',
    '',
    '| Result | Findings | Env vars (read/documented) | Endpoint refs | Metric refs | Command refs |',
    '|---|---|---|---|---|---|',
    `| ${summary.ok ? '✅ pass' : '❌ fail'} | ${summary.total} | ${summary.envVarsRead}/${
      summary.envVarsDocumented
    } | ${summary.routeRefs} | ${summary.metricRefs} | ${summary.commandRefs} |`,
    '',
    ...findings.map((f) => `- \`${where(f)}\` **${f.rule}** ${f.message}`),
    '',
    'Owner: indexer maintainers · Recovery: docs/indexer/operations-checks.md',
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

process.exit(summary.ok ? 0 : 1);

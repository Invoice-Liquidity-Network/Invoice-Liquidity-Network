#!/usr/bin/env node
/**
 * scripts/check-local-dev-docs.mjs
 *
 * Verifies docs/local-development.md against the repository (#1285): every
 * pnpm/make command, path, workspace, environment variable and default, and
 * Docker Compose service/port it documents — plus the local-dev entry points
 * themselves (root scripts, docker-compose.yml, Makefile, dev-setup.sh).
 * See scripts/lib/local-dev-docs.mjs and docs/runbooks/local-dev-docs.md.
 *
 * Usage:
 *   node scripts/check-local-dev-docs.mjs [--repo-root <path>] [--json[=<file>]]
 *
 * Exit codes:
 *   0 — the guide and the local-dev entry points match the repository
 *   1 — at least one finding
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLocalDevDocs } from './lib/local-dev-docs.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--repo-root');
const repoRoot =
  rootIndex >= 0 && args[rootIndex + 1]
    ? resolve(process.cwd(), args[rootIndex + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsonArg = args.find((a) => a === '--json' || a.startsWith('--json='));

const result = checkLocalDevDocs(repoRoot);
const { findings, summary: s } = result;
const where = (f) => (f.line ? `${f.file}:${f.line}` : f.file);

if (jsonArg === '--json') {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (jsonArg) writeFileSync(jsonArg.slice('--json='.length), JSON.stringify(result, null, 2));
  for (const f of findings) console.error(`  ✗ [${f.rule}] ${where(f)} ${f.message}`);
  console.log(
    `Local development guide: ${s.commands} commands, ${s.paths} paths, ${s.envVars} env vars ` +
      `(${s.defaults} defaults), ${s.services} compose services, ${s.workspaces} workspace entries.`
  );
  console.log(
    s.ok
      ? '✓ docs/local-development.md matches the repository.'
      : `\n✗ ${s.total} local-development finding(s). See docs/runbooks/local-dev-docs.md.`
  );
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### Local development guide (`docs/local-development.md`)',
    '',
    '| Result | Findings | Commands | Paths | Env vars | Defaults | Compose services |',
    '|---|---|---|---|---|---|---|',
    `| ${s.ok ? '✅ pass' : '❌ fail'} | ${s.total} | ${s.commands} | ${s.paths} | ${s.envVars} | ${
      s.defaults
    } | ${s.services} |`,
    '',
    ...findings.map((f) => `- \`${where(f)}\` **${f.rule}** ${f.message}`),
    '',
    'Owner: @Invoice-Liquidity-Network/devops · Recovery: docs/runbooks/local-dev-docs.md',
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

process.exit(s.ok ? 0 : 1);

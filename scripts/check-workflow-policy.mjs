#!/usr/bin/env node
/**
 * scripts/check-workflow-policy.mjs
 *
 * GitHub Actions policy + CI/CD documentation check (#1286). See
 * scripts/lib/workflow-policy.mjs and docs/runbooks/workflow-policy.md.
 *
 * Usage:
 *   node scripts/check-workflow-policy.mjs [--repo-root <path>] [--json[=<file>]]
 *   node scripts/check-workflow-policy.mjs --write   # regenerate the inventory
 *
 * Exit codes:
 *   0 — every workflow meets the policy and docs/ci-cd.md matches the files
 *   1 — at least one finding
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC,
  PORT,
  checkWorkflowPolicy,
  inventoryRows,
  loadWorkflows,
  writeInventory,
} from './lib/workflow-policy.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--repo-root');
const repoRoot =
  rootIndex >= 0 && args[rootIndex + 1]
    ? resolve(process.cwd(), args[rootIndex + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsonArg = args.find((a) => a === '--json' || a.startsWith('--json='));

if (args.includes('--write')) {
  // Regenerating is idempotent: running it twice leaves the files unchanged.
  const rows = inventoryRows(loadWorkflows(repoRoot));
  for (const [file, mdx] of [
    [DOC, false],
    [PORT, true],
  ]) {
    const path = join(repoRoot, file);
    if (!existsSync(path)) continue;
    const before = readFileSync(path, 'utf8');
    const after = writeInventory(
      before,
      mdx
        ? rows.map((r) =>
            r.replace(
              '](../.github/',
              '](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/dev/.github/'
            )
          )
        : rows,
      { mdx }
    );
    if (after !== before) writeFileSync(path, after);
    console.log(
      `${after === before ? 'unchanged' : 'updated  '} ${file} (${rows.length} workflows)`
    );
  }
}

const result = checkWorkflowPolicy(repoRoot);
const { findings, summary: s } = result;
const where = (f) => (f.line ? `${f.file}:${f.line}` : f.file);

if (jsonArg === '--json') {
  console.log(JSON.stringify({ findings, summary: s }, null, 2));
} else {
  if (jsonArg)
    writeFileSync(
      jsonArg.slice('--json='.length),
      JSON.stringify({ findings, summary: s }, null, 2)
    );
  for (const f of findings) console.error(`  ✗ [${f.rule}] ${where(f)} ${f.message}`);
  console.log(
    `Workflow policy: ${s.workflows} workflows, ${s.compositeActions} composite actions, ` +
      `${s.thirdPartyActions} pinned third-party actions, ${s.exemptions} exemption(s), ` +
      `${s.inventoryRows} inventory rows.`
  );
  console.log(
    s.ok
      ? '✓ Workflows meet the policy and docs/ci-cd.md matches them.'
      : `\n✗ ${s.total} finding(s). See docs/runbooks/workflow-policy.md.`
  );
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### GitHub Actions policy & CI/CD reference (`docs/ci-cd.md`)',
    '',
    '| Result | Findings | Workflows | Pinned third-party actions | Exemptions |',
    '|---|---|---|---|---|',
    `| ${s.ok ? '✅ pass' : '❌ fail'} | ${s.total} | ${s.workflows} | ${s.thirdPartyActions} | ${
      s.exemptions
    } |`,
    '',
    ...findings.map((f) => `- \`${where(f)}\` **${f.rule}** ${f.message}`),
    '',
    'Owner: @Invoice-Liquidity-Network/devops · Recovery: docs/runbooks/workflow-policy.md',
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

process.exit(s.ok ? 0 : 1);

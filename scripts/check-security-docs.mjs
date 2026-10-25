#!/usr/bin/env node
/**
 * scripts/check-security-docs.mjs
 *
 * Verifies docs/security-guide.md and docs/threat-model.md against the
 * repository (#1287): mitigation evidence, cited claims, mentioned paths, the
 * HTTP security-header middleware, and the canonical-site ports.
 * See scripts/lib/security-docs.mjs and docs/runbooks/security-docs.md.
 *
 * Usage:
 *   node scripts/check-security-docs.mjs [--repo-root <path>] [--json[=<file>]]
 *
 * Exit codes:
 *   0 — every documented security control is backed, linked, or an owned gap
 *   1 — at least one claim is not backed by the repository
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSecurityDocs } from './lib/security-docs.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--repo-root');
const repoRoot =
  rootIndex >= 0 && args[rootIndex + 1]
    ? resolve(process.cwd(), args[rootIndex + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsonArg = args.find((a) => a === '--json' || a.startsWith('--json='));

const result = checkSecurityDocs(repoRoot);
const { findings, summary: s } = result;
const where = (f) => (f.line ? `${f.file}:${f.line}` : f.file);

if (jsonArg === '--json') {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (jsonArg) writeFileSync(jsonArg.slice('--json='.length), JSON.stringify(result, null, 2));
  for (const f of findings) console.error(`  ✗ [${f.rule}] ${where(f)} ${f.message}`);
  console.log(
    `Security docs: ${s.mitigationRows} mitigations (${s.enforced} enforced, ${s.external} external, ` +
      `${s.gaps} owned gaps), ${s.claims} claims, ${s.pathsChecked} paths, ` +
      `security headers in ${s.headerServices} services.`
  );
  console.log(
    s.ok
      ? '✓ Security guide and threat model match the repository.'
      : `\n✗ ${s.total} security documentation finding(s). See docs/runbooks/security-docs.md.`
  );
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### Security guide & threat model (`docs/security-guide.md`, `docs/threat-model.md`)',
    '',
    '| Result | Findings | Enforced | External | Owned gaps | Claims | Header services |',
    '|---|---|---|---|---|---|---|',
    `| ${s.ok ? '✅ pass' : '❌ fail'} | ${s.total} | ${s.enforced} | ${s.external} | ${s.gaps} | ${
      s.claims
    } | ${s.headerServices} |`,
    '',
    ...findings.map((f) => `- \`${where(f)}\` **${f.rule}** ${f.message}`),
    '',
    'Owner: @Invoice-Liquidity-Network/security-lead · Recovery: docs/runbooks/security-docs.md',
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

process.exit(s.ok ? 0 : 1);

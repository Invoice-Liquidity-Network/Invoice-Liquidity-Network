#!/usr/bin/env node
/**
 * check-generated-types-sync.mjs
 *
 * Drift guard for the repo's two generated-type surfaces:
 *   - sdk/src/generated/types.ts        (generator: scripts/generate-types.ts)
 *   - packages/shared/src/types.ts      (generator: scripts/generate-shared-types.mts)
 *
 * Usage:
 *   node scripts/check-generated-types-sync.mjs [--spec <path>]
 *
 * What it does, in layers:
 *
 *   Layer A — always on (no contract spec required):
 *     1. Marker guard: the SDK generated file must carry the AUTO-GENERATED
 *        header so hand edits are caught at review time.
 *     2. Name-conflict guard: any type exported by packages/shared/src/types.ts
 *        must not be locally re-defined in the SDK generated file with a
 *        different shape (mirrors scripts/check-no-duplicate-types.mjs, which
 *        intentionally skips auto-generated files).
 *
 *   Layer B — only when a contract spec exists (backend/target/spec.json
 *   by default): regenerate BOTH files in-memory (dry-run, non-mutating) and
 *   byte-compare against the committed files. Any difference is drift.
 *
 * Exit codes: 0 = in sync, 1 = drift found, 2 = usage/environment error.
 * This script never writes to the worktree.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SDK_GENERATED = join(REPO_ROOT, 'sdk', 'src', 'generated', 'types.ts');
const SHARED_TYPES = join(REPO_ROOT, 'packages', 'shared', 'src', 'types.ts');
const DEFAULT_SPEC = join(REPO_ROOT, 'backend', 'target', 'spec.json');
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// ── Parsing helpers ───────────────────────────────────────────────────────────

const EXPORT_RE = /^export\s+(?:declare\s+)?(type|interface|enum)\s+(\w+)/gm;
const AUTO_GENERATED_RE = /AUTO-GENERATED|auto-generated/i;

/**
 * Extract exported type names and their definition blocks from a generated file.
 * Generated files are flat and blank-line separated, so we capture from the
 * `export` keyword to the next blank line.
 *
 * @param {string} src
 * @returns {Map<string, { kind: string; block: string; preceding: string }>}
 */
export function extractExportedNames(src) {
  const out = new Map();
  EXPORT_RE.lastIndex = 0;
  let m;
  const matches = [];
  while ((m = EXPORT_RE.exec(src)) !== null) {
    matches.push({ kind: m[1], name: m[2], index: m.index });
  }
  for (const { kind, name, index } of matches) {
    const end = src.indexOf('\n\n', index);
    const blockEnd = end === -1 ? src.length : end;
    const block = src.slice(index, blockEnd).trim();
    const preceding = src.slice(Math.max(0, index - 500), index);
    out.set(name, { kind, block, preceding });
  }
  return out;
}

/** Whitespace-agnostic normalization so CRLF / formatting churn is not "drift". */
export function normalizeBlock(block) {
  return block.replace(/\s+/g, ' ').trim();
}

/** A shared type may be re-defined in the SDK only when explicitly justified. */
function hasExplanation(preceding) {
  return (
    /intentionally\s+differs/i.test(preceding) ||
    /not\s+a\s+duplicat/i.test(preceding) ||
    /intentionally\s+different/i.test(preceding) ||
    /SDK-specific/i.test(preceding) ||
    /XDR projection/i.test(preceding)
  );
}

/**
 * Layer A guard — name conflicts / missing markers.
 *
 * @param {string} sharedSrc
 * @param {string} sdkSrc
 * @returns {{ conflicts: Array<{ name: string; kind: string; reason: string }>; missingMarker: boolean }}
 */
export function findSyncIssues(sharedSrc, sdkSrc) {
  const missingMarker = !AUTO_GENERATED_RE.test(sdkSrc.slice(0, 300));
  const sharedNames = extractExportedNames(sharedSrc);
  const sdkNames = extractExportedNames(sdkSrc);
  const conflicts = [];

  for (const [name, sdkDef] of sdkNames) {
    if (!sharedNames.has(name)) continue;
    const sharedDef = sharedNames.get(name);
    if (hasExplanation(sdkDef.preceding)) continue;
    const sameShape = normalizeBlock(sharedDef.block) === normalizeBlock(sdkDef.block);
    if (!sameShape) {
      conflicts.push({ name, kind: sdkDef.kind, reason: 'shape-differs' });
    }
  }

  return { conflicts, missingMarker };
}

// ── Layer B — regenerate and compare against committed files ─────────────────

/**
 * @param {string} specPath
 * @returns {Array<{ file: string; label: string; regenerated: string | null; error: string | null; skipped: boolean }>}
 */
function regenerate(specPath) {
  const entries = [
    {
      file: 'sdk/src/generated/types.ts',
      label: 'pnpm generate:types',
      args: [TSX_CLI, 'scripts/generate-types.ts', '--spec', specPath, '--dry-run'],
    },
    {
      file: 'packages/shared/src/types.ts',
      label: 'pnpm generate:shared-types',
      args: [
        '--import',
        'tsx/esm',
        'scripts/generate-shared-types.mts',
        '--spec',
        specPath,
        '--dry-run',
      ],
    },
  ];
  return entries.map(({ file, label, args }) => {
    if (!existsSync(TSX_CLI)) {
      return { file, label, regenerated: null, error: null, skipped: true };
    }
    const res = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
    if (res.error) {
      return { file, label, regenerated: null, error: res.error.message, skipped: false };
    }
    if (res.status !== 0) {
      return {
        file,
        label,
        regenerated: null,
        error: (res.stderr || res.stdout || '').trim(),
        skipped: false,
      };
    }
    return { file, label, regenerated: res.stdout, error: null, skipped: false };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

function usageError(message) {
  console.error(message);
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

function main() {
  const args = process.argv.slice(2);
  const specFlagIdx = args.indexOf('--spec');
  const specPath = specFlagIdx !== -1 ? resolve(args[specFlagIdx + 1]) : DEFAULT_SPEC;

  for (const f of [SDK_GENERATED, SHARED_TYPES]) {
    if (!existsSync(f)) {
      usageError(`❌ Expected generated file missing: ${f}`);
    }
  }

  const sdkSrc = readFileSync(SDK_GENERATED, 'utf8');
  const sharedSrc = readFileSync(SHARED_TYPES, 'utf8');
  const { conflicts, missingMarker } = findSyncIssues(sharedSrc, sdkSrc);

  const problems = [];

  if (missingMarker) {
    problems.push(
      `SDK generated file lost its AUTO-GENERATED marker: ${SDK_GENERATED}\n` +
        `  Regenerate it with: pnpm generate:types`
    );
  }
  for (const c of conflicts) {
    problems.push(
      `Type "${c.name}" (${c.kind}) is defined with a different shape in ` +
        `sdk/src/generated/types.ts than in packages/shared/src/types.ts.\n` +
        `  Import it from @iln/shared, or mark the SDK definition with an ` +
        `"intentionally differs" comment.`
    );
  }

  let layerB = null;
  const specAvailable = existsSync(specPath) && statSync(specPath).isFile();
  if (specAvailable) {
    layerB = regenerate(specPath);
    for (const item of layerB) {
      if (item.skipped) {
        console.warn(`  ⚠ tsx loader not found — skipping regeneration diff for ${item.file}`);
        continue;
      }
      if (item.error) {
        problems.push(`Could not regenerate from spec (${item.label}): ${item.error}`);
        continue;
      }
      const committed = readFileSync(join(REPO_ROOT, item.file), 'utf8');
      if (normalizeBlock(committed) !== normalizeBlock(item.regenerated)) {
        problems.push(
          `Generated file is out of sync with the contract spec: ${item.file}\n` +
            `  Regenerate and commit: ${item.label}`
        );
      }
    }
  }

  console.log(`Generated-type surfaces checked:`);
  console.log(`  − sdk/src/generated/types.ts`);
  console.log(`  − packages/shared/src/types.ts`);
  console.log(
    `  − contract spec: ${
      specAvailable ? specPath : `absent (${specPath}) — using inventory guard only`
    }`
  );

  if (problems.length > 0) {
    console.error(`\n❌ Generated types are out of sync (${problems.length} issue(s)):\n`);
    for (const p of problems) console.error(`  - ${p}\n`);
    console.error(`Run: pnpm generate:types && pnpm generate:shared-types`);
    process.exit(1);
  }

  console.log(`\n✅ Generated types are in sync.`);
  process.exit(0);
}

if (isMain) {
  main();
}

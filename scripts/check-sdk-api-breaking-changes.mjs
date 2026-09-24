#!/usr/bin/env node
/**
 * check-sdk-api-breaking-changes.mjs
 *
 * Drift and semver gate for the `@iln/sdk` public API (Issue #1029).
 *
 * 1. Regenerates the API snapshot from the current source (in memory).
 * 2. Diffs it against the committed baseline (sdk/api-snapshot.json).
 * 3. Classifies every difference as breaking or non-breaking.
 * 4. If breaking changes are present, a "major" changeset for `@iln/sdk`
 *    MUST already exist in .changeset/ — otherwise the check fails.
 *
 * Exit codes:
 *   0 = API unchanged (snapshot in sync)
 *   1 = API changed — regenerate sdk/api-snapshot.json (and add a `major`
 *       changeset when changes are breaking)
 *   2 = usage/environment error
 *
 * Classification rules (surviving changes are non-breaking):
 *   breaking     export removed, kind changed, enum member removed or revalued,
 *                class/interface member removed, return/param type changed
 *                (with one heuristic exception below), param required↔optional,
 *                overloads removed, type-alias shape changed
 *   narrowing    an old `A | B` (or `unknown`/`any`) type replaced by a single
 *                member of that union is treated as a narrow (still assignable
 *                to the old type) — non-breaking
 *   additive     new exports, enum members and optional params are fine
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSnapshot, readSnapshot, SNAPSHOT_PATH } from './generate-sdk-api-snapshot.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGESET_DIR = join(REPO_ROOT, '.changeset');
const SDK_PACKAGE = '@iln/sdk';

// ── Classification helpers ────────────────────────────────────────────────────

/**
 * Heuristic: is `nextType` a safe narrowing of `prevType`?
 * True when the previous was `unknown`/`any`, or when the previous was a
 * union and the next is exactly one of its branches.
 */
export function isUnionNarrowing(prevType, nextType) {
  const next = nextType.trim();
  if (prevType.trim() === next) return false;
  if ({ unknown: true, any: true, '{}': true }[prevType.trim()]) return true;
  const branches = prevType.split(/\|/);
  return branches.some((branch) => branch.trim() === next);
}

// ── Comparison ────────────────────────────────────────────────────────────────

function addChange(changes, path, breaking, message) {
  changes.push({ path, breaking, message });
}

function compareValueMember(name, prev, next, changes, path) {
  const memberPath = `${path}.${name}`;
  if (prev.type !== next.type) {
    if (isUnionNarrowing(prev.type, next.type)) {
      addChange(
        changes,
        memberPath,
        false,
        `member "${name}" of ${path}: return/property type narrowed (${prev.type} → ${next.type})`
      );
    } else {
      addChange(
        changes,
        memberPath,
        true,
        `member "${name}" of ${path}: type changed (${prev.type} → ${next.type})`
      );
    }
  } else if (!prev.optional && next.optional) {
    addChange(
      changes,
      memberPath,
      false,
      `member "${name}" of ${path} became optional (was required)`
    );
  } else if (prev.optional && !next.optional) {
    addChange(
      changes,
      memberPath,
      true,
      `member "${name}" of ${path} became required (was optional)`
    );
  }
}

function compareSignatures(prev, next, changes, path) {
  if (next.signatures.length < prev.signatures.length) {
    addChange(
      changes,
      path,
      true,
      `overloads removed from ${path} (${prev.signatures.length} → ${next.signatures.length})`
    );
    return;
  }
  for (let s = 0; s < next.signatures.length; s++) {
    const sigPath = next.signatures.length === prev.signatures.length ? `${path}[${s}]` : path;
    const a = prev.signatures[Math.min(s, prev.signatures.length - 1)];
    const b = next.signatures[s];
    if (a.typeParams?.join() !== b.typeParams?.join()) {
      addChange(changes, sigPath, true, `type parameters changed on ${path}`);
    }
    if (a.returnType !== b.returnType) {
      if (isUnionNarrowing(a.returnType, b.returnType)) {
        addChange(
          changes,
          sigPath,
          false,
          `return type of ${path} narrowed (${a.returnType} → ${b.returnType})`
        );
      } else {
        addChange(
          changes,
          sigPath,
          true,
          `return type of ${path} changed (${a.returnType} → ${b.returnType})`
        );
      }
    }
    const minLen = Math.min(a.params.length, b.params.length);
    for (let p = 0; p < minLen; p++) {
      const pa = a.params[p];
      const pb = b.params[p];
      const paramPath = `${sigPath}.${pa.name}`;
      if (pa.type !== pb.type) {
        addChange(
          changes,
          paramPath,
          true,
          `parameter "${pa.name}" of ${path}: type changed (${pa.type} → ${pb.type})`
        );
      } else if (!pa.optional && pb.optional) {
        addChange(changes, paramPath, false, `parameter "${pa.name}" of ${path} became optional`);
      } else if (pa.optional && !pb.optional) {
        addChange(changes, paramPath, true, `parameter "${pa.name}" of ${path} became required`);
      }
    }
    if (b.params.length > a.params.length) {
      for (const added of b.params.slice(a.params.length)) {
        addChange(
          changes,
          `${sigPath}.${added.name}`,
          !added.optional,
          `parameter "${added.name}" ${added.optional ? 'was added to' : 'added to'} ${path}`
        );
      }
    } else if (b.params.length < a.params.length) {
      addChange(
        changes,
        sigPath,
        true,
        `parameters removed from ${path} (${a.params.length} → ${b.params.length})`
      );
    }
  }
}

function compareObjectKind(prev, next, changes, path) {
  const prevMembers = prev.members ?? {};
  const nextMembers = next.members ?? {};
  for (const [name, prevValue] of Object.entries(prevMembers)) {
    if (!(name in nextMembers)) {
      addChange(changes, `${path}.${name}`, true, `member "${name}" removed from ${path}`);
    } else {
      compareValueMember(name, prevValue, nextMembers[name], changes, path);
    }
  }
  for (const [name] of Object.entries(nextMembers).filter(([n]) => !(n in prevMembers))) {
    addChange(changes, `${path}.${name}`, false, `member "${name}" added to ${path}`);
  }
}

function compareExport(name, prev, next, changes) {
  const path = `exports.${name}`;
  if (prev.kind !== next.kind) {
    addChange(changes, path, true, `export "${name}" changed kind (${prev.kind} → ${next.kind})`);
    return;
  }
  switch (prev.kind) {
    case 'enum': {
      for (const [member, value] of Object.entries(prev.members)) {
        if (!(member in next.members)) {
          addChange(changes, `${path}.${member}`, true, `enum member "${name}.${member}" removed`);
        } else if (next.members[member] !== value) {
          addChange(
            changes,
            `${path}.${member}`,
            true,
            `enum member "${name}.${member}" revalued (${value} → ${next.members[member]})`
          );
        }
      }
      for (const [member] of Object.entries(next.members).filter(([m]) => !(m in prev.members))) {
        addChange(changes, `${path}.${member}`, false, `enum member "${name}.${member}" added`);
      }
      break;
    }
    case 'class':
    case 'interface':
      if (prev.typeParams?.join() !== next.typeParams?.join()) {
        addChange(
          changes,
          path,
          true,
          `type parameters changed on ${name} (${(prev.typeParams ?? []).join()} → ${(
            next.typeParams ?? []
          ).join()})`
        );
      }
      compareObjectKind(prev, next, changes, path);
      break;
    case 'function':
      compareSignatures(prev, next, changes, path);
      break;
    case 'type':
      if (prev.type !== next.type) {
        if (isUnionNarrowing(prev.type, next.type)) {
          addChange(
            changes,
            path,
            false,
            `type alias "${name}" narrowed (${prev.type} → ${next.type})`
          );
        } else {
          addChange(
            changes,
            path,
            true,
            `type alias "${name}" changed (${prev.type} → ${next.type})`
          );
        }
      }
      break;
    case 'const':
    case 'let':
      if (prev.type !== next.type) {
        if (isUnionNarrowing(prev.type, next.type)) {
          addChange(
            changes,
            path,
            false,
            `export "${name}" type narrowed (${prev.type} → ${next.type})`
          );
        } else {
          addChange(
            changes,
            path,
            true,
            `export "${name}" type changed (${prev.type} → ${next.type})`
          );
        }
      }
      break;
    default:
      addChange(
        changes,
        path,
        true,
        `export "${name}" has unknown kind "${prev.kind}" — manual review required`
      );
  }
}

/**
 * @param {object} baseline committed snapshot
 * @param {object} current freshly generated snapshot
 * @returns {{ changes: Array<{path: string; breaking: boolean; message: string}> }}
 */
export function compareApiSnapshots(baseline, current) {
  const changes = [];
  const prevExports = baseline.exports ?? {};
  const nextExports = current.exports ?? {};

  for (const [name, prev] of Object.entries(prevExports)) {
    if (!(name in nextExports)) {
      addChange(changes, `exports.${name}`, true, `export "${name}" removed`);
    } else {
      compareExport(name, prev, nextExports[name], changes);
    }
  }
  for (const [name] of Object.entries(nextExports).filter(([n]) => !(n in prevExports))) {
    addChange(changes, `exports.${name}`, false, `export "${name}" added`);
  }
  return { changes };
}

// ── Changeset inspection ──────────────────────────────────────────────────────

/**
 * @param {string} dir changeset metadata directory (.changeset)
 * @param {string} pkg package name, e.g. "@iln/sdk"
 * @returns {boolean} true when a changeset declares a `major` bump for `pkg`
 */
export function hasMajorChangeset(dir = CHANGESET_DIR, pkg = SDK_PACKAGE) {
  if (!existsSync(dir)) return false;
  const wanted = `"${pkg}": major`;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = readFileSync(join(dir, file), 'utf8');
    if (content.includes(wanted)) return true;
  }
  return false;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function summarize(changes) {
  const breaking = changes.filter((c) => c.breaking);
  const nonBreaking = changes.filter((c) => !c.breaking);
  const lines = [];
  if (breaking.length) {
    lines.push(`\n❌ ${breaking.length} breaking change(s):`);
    for (const c of breaking) lines.push(`  - [breaking] ${c.message}`);
  }
  if (nonBreaking.length) {
    lines.push(`\nℹ ${nonBreaking.length} non-breaking change(s):`);
    for (const c of nonBreaking) lines.push(`  - ${c.message}`);
  }
  return lines.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  try {
    const baseline = readSnapshot(SNAPSHOT_PATH);
    const current = buildSnapshot();
    const { changes } = compareApiSnapshots(baseline, current);

    if (changes.length === 0) {
      console.log('✅ SDK public API is unchanged and the snapshot is in sync.');
      process.exit(0);
    }

    console.log(`SDK public API changes detected:`);
    console.log(summarize(changes));

    const breaking = changes.filter((c) => c.breaking);
    const majorRequired = breaking.length > 0;
    const hasMajor = hasMajorChangeset();

    if (majorRequired && !hasMajor) {
      console.error(
        `\n❌ This PR introduces breaking SDK API changes but no "major" changeset for ` +
          `"@iln/sdk" exists in .changeset/.\n` +
          `If this is intended, run: pnpm changeset` +
          ` and mark the "@iln/sdk" bump as major.\n` +
          `Afterwards, regenerate and commit the snapshot:\n  pnpm sdk:api:snapshot`
      );
      process.exit(1);
    }

    console.error(
      `\n❌ SDK API snapshot is out of date.\n` +
        `Regenerate and commit it:\n  pnpm sdk:api:snapshot`
    );
    process.exit(1);
  } catch (err) {
    console.error(`SDK API check failed: ${err.message}`);
    process.exit(2);
  }
}

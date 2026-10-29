/**
 * Resolves which @iln/sdk versions the backward-compatibility matrix
 * (Issue #1035) should test against.
 *
 * "Last three published minor releases" needs a source of released
 * versions. This repo has never tagged or published an @iln/sdk release
 * (no `sdk-v*` git tags exist, and it's a workspace-only package today), so
 * that source doesn't exist yet — see the "Bootstrap mode" note below.
 *
 * Versioning source: git tags matching `sdk-v<semver>` (e.g. `sdk-v0.3.1`),
 * the convention this matrix expects future @iln/sdk releases to use. When
 * three or more distinct minors are tagged, the newest patch of each of the
 * three most recent minors is returned. Below that, it degrades gracefully:
 * whatever tagged minors exist are included, plus the current working-tree
 * version (so there's always at least one real thing to test against).
 */

import { execFileSync } from 'child_process';

/** Minimal semver parse — this repo's versions are plain major.minor.patch, no prerelease/build metadata. */
export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

export function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Reduces a list of "sdk-v<version>" tags to the newest patch per minor,
 * sorted newest-minor-first.
 */
export function latestPatchPerMinor(tags, tagPrefix = 'sdk-v') {
  const byMinor = new Map();
  for (const tag of tags) {
    if (!tag.startsWith(tagPrefix)) continue;
    const version = parseVersion(tag.slice(tagPrefix.length));
    if (!version) continue;
    const minorKey = `${version.major}.${version.minor}`;
    const existing = byMinor.get(minorKey);
    if (!existing || compareVersions(version, existing.version) > 0) {
      byMinor.set(minorKey, { tag, version });
    }
  }
  return [...byMinor.values()].sort((a, b) => compareVersions(b.version, a.version));
}

function defaultListTags() {
  try {
    return execFileSync('git', ['tag', '--list'], { encoding: 'utf-8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.tagPrefix] - e.g. 'sdk-v'
 * @param {number} [opts.minorsToKeep] - how many of the most recent minors to test
 * @param {string} [opts.currentVersion] - the working tree's sdk/package.json version
 * @param {() => string[]} [opts.listTags] - injectable for testing
 * @returns {Array<{ version: string, ref: string | null, source: 'tag' | 'working-tree' }>}
 *   `ref: null` means "the current working tree" (not a specific git ref) — the
 *   bootstrap-mode entry, used whenever fewer than `minorsToKeep` real releases
 *   are tagged yet, or the working tree is ahead of the newest tagged minor.
 */
export function resolveSdkVersions({
  tagPrefix = 'sdk-v',
  minorsToKeep = 3,
  currentVersion,
  listTags = defaultListTags,
} = {}) {
  const tagged = latestPatchPerMinor(listTags(), tagPrefix).slice(0, minorsToKeep);
  const entries = tagged.map(({ tag, version }) => ({
    version: `${version.major}.${version.minor}.${version.patch}`,
    ref: tag,
    source: 'tag',
  }));

  const current = currentVersion ? parseVersion(currentVersion) : null;
  const newestTagged = tagged[0]?.version ?? null;
  const currentIsNewer = current && (!newestTagged || compareVersions(current, newestTagged) > 0);

  if ((entries.length < minorsToKeep || currentIsNewer) && current) {
    entries.unshift({ version: currentVersion, ref: null, source: 'working-tree' });
  }

  return entries.slice(0, minorsToKeep);
}

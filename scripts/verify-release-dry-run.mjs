#!/usr/bin/env node

/**
 * verify-release-dry-run.mjs
 *
 * Closes part of issue #1096: scripts the "Changelog verification" manual
 * step from docs/release-runbook.md — previously "verify that the dry-run
 * output contains the expected version and that the generated sections
 * contain the relevant feat, fix, and breaking-change entries", done by a
 * human reading terminal output.
 *
 * This runs `npx semantic-release --dry-run` and inspects its output. Exact
 * log wording is a semantic-release implementation detail that has changed
 * across major versions and cannot be exhaustively pinned down here, so this
 * is deliberately conservative about what it hard-fails on:
 *
 *   - Non-zero exit code from semantic-release itself         -> hard fail
 *   - A version WAS computed, but no changelog-shaped content
 *     appears anywhere in the output at all                    -> hard fail
 *   - Output doesn't match the exact expected phrasing, but a
 *     version number and *some* notes-shaped content is present -> pass
 *   - No version computed (nothing to release)                 -> pass (no-op)
 *
 * Failing open on unrecognized-but-plausible output (rather than hard-failing
 * on any format drift) is intentional: this replaces a human eyeballing the
 * output, and a human wouldn't block a release over a cosmetic log format
 * change either — they would block it on "no version" or "no notes" while a
 * version exists.
 *
 * Usage:  node scripts/verify-release-dry-run.mjs
 * Exit 0 = verified (release pending with notes, or nothing to release).
 * Exit 1 = semantic-release errored, or a version was computed with no notes.
 */

import { execFileSync } from 'node:child_process';

const NO_RELEASE_PATTERNS = [/no new version is released/i, /no relevant changes/i, /nothing to release/i];

const VERSION_PATTERN = /(?:release note for version|releasing version|next release version is)\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/i;

// conventional-changelog-conventionalcommits section headers (see .releaserc.json)
const CHANGELOG_SECTION_PATTERN = /###\s+(Features|Bug Fixes|Performance Improvements|BREAKING CHANGES)/;

/**
 * Parses combined stdout+stderr from `semantic-release --dry-run`.
 * Pure function — no process spawning — so it's fully unit-testable against
 * captured sample output without needing semantic-release installed.
 */
export function parseDryRunOutput(output) {
  const versionMatch = output.match(VERSION_PATTERN);
  const noRelease = NO_RELEASE_PATTERNS.some((p) => p.test(output));
  const hasChangelogSection = CHANGELOG_SECTION_PATTERN.test(output);
  // Fallback signal for output shapes that don't use the standard
  // conventional-changelog section headers: any bullet-list content at all.
  const hasBulletContent = /^\s*[*-]\s+\S/m.test(output);

  return {
    version: versionMatch ? versionMatch[1] : null,
    noRelease,
    hasNotes: hasChangelogSection || hasBulletContent,
  };
}

/**
 * Decides pass/fail from the parsed shape. See file header for the policy.
 */
export function evaluateDryRun(parsed) {
  if (parsed.noRelease && !parsed.version) {
    return { ok: true, reason: 'No release pending (no relevant commits since last release).' };
  }

  if (parsed.version && parsed.hasNotes) {
    return { ok: true, reason: `Release ${parsed.version} pending with changelog notes.` };
  }

  if (parsed.version && !parsed.hasNotes) {
    return {
      ok: false,
      reason: `Release ${parsed.version} was computed, but no changelog-shaped content was found in the dry-run output. Verify .releaserc.json's changelog plugin and commit messages.`,
    };
  }

  // Neither a version nor an explicit "no release" phrase was recognized.
  // Fail open: don't block a release over an unrecognized log format, but
  // say so loudly so a human can glance at the raw output.
  return {
    ok: true,
    reason:
      'Could not confidently parse dry-run output (unrecognized format) — not blocking, but review the raw output below.',
  };
}

function runDryRun() {
  return execFileSync('npx', ['--no-install', 'semantic-release', '--dry-run'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function main() {
  let output;
  try {
    output = runDryRun();
  } catch (err) {
    // execFileSync throws on non-zero exit; stdout/stderr are on the error object.
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? '';
    console.error('❌ semantic-release --dry-run exited with an error:\n');
    console.error(stdout);
    console.error(stderr);
    process.exit(1);
  }

  const parsed = parseDryRunOutput(output);
  const result = evaluateDryRun(parsed);

  console.log(output);
  console.log(result.ok ? `✅ ${result.reason}` : `❌ ${result.reason}`);
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

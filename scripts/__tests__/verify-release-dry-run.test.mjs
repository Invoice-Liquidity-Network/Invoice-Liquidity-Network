import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDryRunOutput, evaluateDryRun } from '../verify-release-dry-run.mjs';

const SAMPLE_RELEASE_OUTPUT = `
[semantic-release] › ℹ  Running semantic-release version 24.0.0
[semantic-release] › ✔  Found git tag v1.2.0 associated with version 1.2.0 on branch main
[semantic-release] › ℹ  Analyzing commit: feat(sdk): add invoice filtering
[semantic-release] › ✔  Analyzed 3 commits: releasing 1.3.0
[semantic-release] › ℹ  Release note for version 1.3.0:
## [1.3.0](https://example.com/compare/v1.2.0...v1.3.0) (2026-09-26)

### Features

* **sdk:** add invoice filtering ([abc1234](https://example.com/commit/abc1234))
`;

const SAMPLE_NO_RELEASE_OUTPUT = `
[semantic-release] › ℹ  Running semantic-release version 24.0.0
[semantic-release] › ✔  Found git tag v1.2.0 associated with version 1.2.0 on branch main
[semantic-release] › ℹ  There are no relevant changes, so no new version is released.
`;

const SAMPLE_VERSION_NO_NOTES_OUTPUT = `
[semantic-release] › ℹ  Running semantic-release version 24.0.0
[semantic-release] › ℹ  Release note for version 1.3.0:
`;

describe('parseDryRunOutput', () => {
  it('extracts the computed version and detects changelog sections', () => {
    const parsed = parseDryRunOutput(SAMPLE_RELEASE_OUTPUT);
    assert.equal(parsed.version, '1.3.0');
    assert.equal(parsed.noRelease, false);
    assert.equal(parsed.hasNotes, true);
  });

  it('detects the "no release" case', () => {
    const parsed = parseDryRunOutput(SAMPLE_NO_RELEASE_OUTPUT);
    assert.equal(parsed.version, null);
    assert.equal(parsed.noRelease, true);
  });

  it('detects a version with no changelog content', () => {
    const parsed = parseDryRunOutput(SAMPLE_VERSION_NO_NOTES_OUTPUT);
    assert.equal(parsed.version, '1.3.0');
    assert.equal(parsed.hasNotes, false);
  });

  it('falls back to bullet-list detection when there is no conventional-changelog header', () => {
    const output = 'Release note for version 2.0.0:\n\n* did a thing\n* did another thing\n';
    const parsed = parseDryRunOutput(output);
    assert.equal(parsed.version, '2.0.0');
    assert.equal(parsed.hasNotes, true);
  });
});

describe('evaluateDryRun', () => {
  it('passes when a version and notes are both present', () => {
    const result = evaluateDryRun({ version: '1.3.0', noRelease: false, hasNotes: true });
    assert.equal(result.ok, true);
  });

  it('passes when there is nothing to release', () => {
    const result = evaluateDryRun({ version: null, noRelease: true, hasNotes: false });
    assert.equal(result.ok, true);
  });

  it('fails when a version was computed but no notes were found', () => {
    const result = evaluateDryRun({ version: '1.3.0', noRelease: false, hasNotes: false });
    assert.equal(result.ok, false);
  });

  it('fails open (does not block) on an unrecognized output shape', () => {
    const result = evaluateDryRun({ version: null, noRelease: false, hasNotes: false });
    assert.equal(result.ok, true);
  });
});

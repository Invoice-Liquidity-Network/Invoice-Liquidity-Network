import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVersion,
  compareVersions,
  latestPatchPerMinor,
  resolveSdkVersions,
} from '../lib/sdk-compat-versions.mjs';

describe('parseVersion', () => {
  it('parses a plain major.minor.patch string', () => {
    assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 });
  });

  it('returns null for anything else', () => {
    assert.equal(parseVersion('1.2'), null);
    assert.equal(parseVersion('1.2.3-beta'), null);
    assert.equal(parseVersion('not-a-version'), null);
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    assert.ok(compareVersions(parseVersion('1.0.0'), parseVersion('0.9.9')) > 0);
    assert.ok(compareVersions(parseVersion('0.2.0'), parseVersion('0.1.9')) > 0);
    assert.ok(compareVersions(parseVersion('0.1.2'), parseVersion('0.1.1')) > 0);
    assert.equal(compareVersions(parseVersion('0.1.1'), parseVersion('0.1.1')), 0);
  });
});

describe('latestPatchPerMinor', () => {
  it('keeps only the newest patch per minor, newest-minor-first', () => {
    const tags = ['sdk-v0.1.0', 'sdk-v0.1.2', 'sdk-v0.1.1', 'sdk-v0.2.0', 'sdk-v0.3.0', 'sdk-v0.3.1'];
    const result = latestPatchPerMinor(tags);
    assert.deepEqual(
      result.map((r) => r.tag),
      ['sdk-v0.3.1', 'sdk-v0.2.0', 'sdk-v0.1.2']
    );
  });

  it('ignores tags that do not match the prefix or are not valid semver', () => {
    const tags = ['cli-v1.0.0', 'sdk-v0.1.0', 'sdk-vnot-a-version', 'random-tag'];
    const result = latestPatchPerMinor(tags);
    assert.equal(result.length, 1);
    assert.equal(result[0].tag, 'sdk-v0.1.0');
  });

  it('returns an empty array when no tags match', () => {
    assert.deepEqual(latestPatchPerMinor([]), []);
  });
});

describe('resolveSdkVersions', () => {
  it('bootstrap mode: no tags at all falls back to a single working-tree entry', () => {
    const result = resolveSdkVersions({ currentVersion: '0.1.0', listTags: () => [] });
    assert.deepEqual(result, [{ version: '0.1.0', ref: null, source: 'working-tree' }]);
  });

  it('fewer than 3 tagged minors: includes all tags plus the working tree, capped at minorsToKeep', () => {
    const result = resolveSdkVersions({
      currentVersion: '0.3.0',
      listTags: () => ['sdk-v0.1.0', 'sdk-v0.2.0'],
    });
    assert.equal(result.length, 3);
    assert.equal(result[0].source, 'working-tree');
    assert.equal(result[0].version, '0.3.0');
    assert.deepEqual(result.slice(1).map((r) => r.version), ['0.2.0', '0.1.0']);
  });

  it('3+ tagged minors with working tree matching the newest tag: uses tags only, no duplicate', () => {
    const result = resolveSdkVersions({
      currentVersion: '0.4.0',
      listTags: () => ['sdk-v0.1.0', 'sdk-v0.2.0', 'sdk-v0.3.0', 'sdk-v0.4.0'],
    });
    assert.equal(result.length, 3);
    assert.deepEqual(result.map((r) => r.version), ['0.4.0', '0.3.0', '0.2.0']);
    assert.ok(result.every((r) => r.source === 'tag'));
  });

  it('3+ tagged minors but working tree is ahead (unreleased minor in progress): prepends working tree, still capped', () => {
    const result = resolveSdkVersions({
      currentVersion: '0.5.0',
      listTags: () => ['sdk-v0.1.0', 'sdk-v0.2.0', 'sdk-v0.3.0', 'sdk-v0.4.0'],
    });
    assert.equal(result.length, 3);
    assert.equal(result[0].source, 'working-tree');
    assert.equal(result[0].version, '0.5.0');
    assert.deepEqual(result.slice(1).map((r) => r.version), ['0.4.0', '0.3.0']);
  });

  it('respects a custom minorsToKeep', () => {
    const result = resolveSdkVersions({
      currentVersion: '0.1.0',
      minorsToKeep: 1,
      listTags: () => [],
    });
    assert.equal(result.length, 1);
  });
});

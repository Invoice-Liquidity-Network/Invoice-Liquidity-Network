import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildGates,
  CHANGESET_DIR,
  checkChangesetPresent,
  checkSurfaceExportEntries,
  checkSurfacePackageVersions,
} from '../check-sdk-release-gates.mjs';
import { SDK_SURFACES } from '../check-sdk-export-maps.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../check-sdk-release-gates.mjs');

function write(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

/** Scaffold every SDK surface's package.json with a valid version + exports map. */
function scaffoldHealthySurfaces(root, overrides = {}) {
  for (const surface of SDK_SURFACES) {
    write(root, join(surface.dir, 'package.json'), {
      name: surface.pkg,
      version: '1.0.0',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/index.cjs' } },
      ...(overrides[surface.dir] ?? {}),
    });
  }
}

function withTmpRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'iln-release-gates-'));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('checkSurfacePackageVersions', () => {
  it('passes when every SDK surface declares a valid semantic version', () => {
    withTmpRoot((root) => {
      scaffoldHealthySurfaces(root);
      assert.deepEqual(checkSurfacePackageVersions(root), []);
    });
  });

  it('flags a surface whose package.json is missing', () => {
    withTmpRoot((root) => {
      scaffoldHealthySurfaces(root);
      rmSync(join(root, 'packages/react/package.json'));
      const findings = checkSurfacePackageVersions(root);
      assert.equal(findings.length, 1);
      assert.match(findings[0], /packages\/react\/package\.json is missing/);
    });
  });

  it('flags a non-legacy surface (packages/sdk) with an invalid version — issue #1503 completeness gap', () => {
    withTmpRoot((root) => {
      scaffoldHealthySurfaces(root, { 'packages/sdk': { version: 'not-a-semver' } });
      const findings = checkSurfacePackageVersions(root);
      assert.equal(findings.length, 1);
      assert.match(findings[0], /packages\/sdk\/package\.json must have a valid semantic version/);
    });
  });
});

describe('checkSurfaceExportEntries', () => {
  it('passes when every SDK surface declares a non-empty exports map', () => {
    withTmpRoot((root) => {
      scaffoldHealthySurfaces(root);
      assert.deepEqual(checkSurfaceExportEntries(root), []);
    });
  });

  it('flags a non-legacy surface (packages/react) with no exports field — issue #1503 completeness gap', () => {
    withTmpRoot((root) => {
      scaffoldHealthySurfaces(root, { 'packages/react': { exports: undefined } });
      const findings = checkSurfaceExportEntries(root);
      assert.equal(findings.length, 1);
      assert.match(findings[0], /packages\/react\/package\.json must define an exports field/);
    });
  });
});

describe('checkChangesetPresent', () => {
  it('fails closed when the changeset directory does not exist', () => {
    withTmpRoot((root) => {
      assert.deepEqual(checkChangesetPresent(root), [`${CHANGESET_DIR}/ directory is missing.`]);
    });
  });

  it('fails closed when the changeset directory has no pending entries', () => {
    withTmpRoot((root) => {
      write(root, `${CHANGESET_DIR}/README.md`, '# changesets\n');
      const findings = checkChangesetPresent(root);
      assert.equal(findings.length, 1);
      assert.match(findings[0], /No pending changeset entry found/);
    });
  });

  it('passes when at least one pending changeset markdown file exists', () => {
    withTmpRoot((root) => {
      write(root, `${CHANGESET_DIR}/README.md`, '# changesets\n');
      write(root, `${CHANGESET_DIR}/fuzzy-wombat.md`, '---\n"@iln/sdk-next": patch\n---\n\nFix thing.\n');
      assert.deepEqual(checkChangesetPresent(root), []);
    });
  });
});

describe('buildGates completeness', () => {
  it('covers changesets, exports, compatibility, and support windows gates by name', () => {
    withTmpRoot((root) => {
      const names = buildGates(root).map((gate) => gate.name);
      assert.ok(names.includes('Release Changeset Present'));
      assert.ok(names.includes('SDK Export Entries'));
      assert.ok(names.includes('Compatibility Matrix'));
      assert.ok(names.includes('SDK Support Windows'));
    });
  });
});

describe('check-sdk-release-gates.mjs CLI', () => {
  it('exits non-zero against an empty root (every gate fails closed)', () => {
    withTmpRoot((root) => {
      const result = spawnSync(process.execPath, [SCRIPT, `--root=${root}`], { encoding: 'utf8' });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, /Release blocked/);
    });
  });
});

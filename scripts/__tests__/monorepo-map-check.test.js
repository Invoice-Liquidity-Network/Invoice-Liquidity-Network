import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();

test('monorepo map checker fails when a workspace package is undocumented', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'iln-monorepo-map-'));

  try {
    mkdirSync(join(tempRoot, 'packages', 'new-service'), { recursive: true });
    mkdirSync(join(tempRoot, 'docs'), { recursive: true });
    writeFileSync(
      join(tempRoot, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\n',
      'utf8'
    );
    writeFileSync(
      join(tempRoot, 'docs', 'monorepo-map.md'),
      [
        '# Monorepo Map',
        '',
        '## Shared Library Packages',
        '',
        '| Path | Package | Purpose |',
        '|------|---------|---------|',
        '| `packages/shared/` | `@iln/shared` | Shared library |',
        '',
      ].join('\n'),
      'utf8'
    );

    const result = spawnSync(
      process.execPath,
      ['scripts/check-monorepo-map.mjs', '--repo-root', tempRoot],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 1, 'checker should fail when package is undocumented');
    assert.match(
      `${result.stderr}${result.stdout}`,
      /undocumented|missing from monorepo map/i,
      'output should name the undocumented package'
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

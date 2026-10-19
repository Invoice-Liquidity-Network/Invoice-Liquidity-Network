import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkScript = join(repoRoot, 'scripts', 'check-meta-nav.mjs');

test('canonical documentation navigation passes parse validation', () => {
  const result = spawnSync(process.execPath, [checkScript, '--canonical'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, `Expected check-meta-nav.mjs --canonical to pass with exit code 0. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /All _meta.json files are in sync with the file tree/);
});

test('check-meta-nav detects explicit docs-dir argument for packages/docs/content', () => {
  const result = spawnSync(process.execPath, [checkScript, '--docs-dir', 'packages/docs/content'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0);
});

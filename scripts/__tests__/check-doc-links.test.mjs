import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkExternalLink } from '../check-doc-links.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkScript = join(repoRoot, 'scripts', 'check-doc-links.mjs');
const roots = [];

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test('doc link check ignores links inside fenced Markdown examples', () => {
  const root = mkdtempSync(join(tmpdir(), 'iln-doc-links-'));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'real-target.md'), '# Exists\n');
  writeFileSync(
    join(root, 'guide.md'),
    '# Guide\n\n```md\n[example](missing-example.md)\n```\n\nInline: `[inline](missing-inline.md)`\n\n[real](real-target.md)\n'
  );

  const result = spawnSync(process.execPath, [checkScript, 'guide.md'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /missing-example\.md/);
  assert.doesNotMatch(result.stdout, /missing-inline\.md/);
});

test('doc link check fails when a local target is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'iln-doc-links-'));
  roots.push(root);
  writeFileSync(join(root, 'guide.md'), '# Guide\n\n[missing](missing-page.md)\n');

  const result = spawnSync(process.execPath, [checkScript, 'guide.md'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing missing-page\.md/);
});

test('doc link check reevaluates the filesystem after a missing target is restored', () => {
  const root = mkdtempSync(join(tmpdir(), 'iln-doc-links-'));
  roots.push(root);
  writeFileSync(join(root, 'guide.md'), '# Guide\n\n[recovered](target.md)\n');

  const firstRun = spawnSync(process.execPath, [checkScript, 'guide.md'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(firstRun.status, 1);

  writeFileSync(join(root, 'target.md'), '# Restored target\n');
  const restartedRun = spawnSync(process.execPath, [checkScript, 'guide.md'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(restartedRun.status, 0, restartedRun.stderr || restartedRun.stdout);
});

test('doc link check fails closed when a selected tree has no Markdown files', () => {
  const root = mkdtempSync(join(tmpdir(), 'iln-doc-links-'));
  roots.push(root);
  mkdirSync(join(root, 'empty'));

  const result = spawnSync(process.execPath, [checkScript, 'empty/**/*.md'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /No files to check/);
});

test('doc link check warns when external fetch fails but fails on an HTTP error response', async () => {
  const unavailable = await checkExternalLink('https://docs.example.invalid', async () => {
    throw new Error('network unavailable');
  });
  assert.equal(unavailable.problem, null);
  assert.match(unavailable.warning, /could not be verified/);

  const broken = await checkExternalLink('https://docs.example.invalid', async () => ({
    ok: false,
    status: 404,
  }));
  assert.equal(broken.warning, null);
  assert.match(broken.problem, /404/);
});

test('doc link check treats rate limiting and server errors as unverified, not broken', async () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const result = await checkExternalLink('https://docs.example.invalid', async () => ({
      ok: false,
      status,
    }));
    assert.equal(result.problem, null, `HTTP ${status}`);
    assert.match(result.warning, new RegExp(`HTTP ${status}`));
  }
  const gone = await checkExternalLink('https://docs.example.invalid', async () => ({
    ok: false,
    status: 410,
  }));
  assert.match(gone.problem, /410/);
});

test('doc link check retries HEAD rejections with GET before judging the link', async () => {
  for (const status of [403, 405, 501]) {
    const methods = [];
    const ok = await checkExternalLink('https://docs.example.invalid', async (_url, init) => {
      methods.push(init.method);
      return init.method === 'HEAD' ? { ok: false, status } : { ok: true, status: 200 };
    });
    assert.deepEqual(methods, ['HEAD', 'GET']);
    assert.deepEqual(ok, { problem: null, warning: null });
  }
  const forbidden = await checkExternalLink('https://docs.example.invalid', async () => ({
    ok: false,
    status: 403,
  }));
  assert.match(forbidden.problem, /403/);
});

import { execSync } from 'node:child_process';
import assert from 'node:assert';

try {
  execSync('node scripts/check-doc-links.mjs tests/docs-link-check/regression/**/*.md', { stdio: 'pipe' });
  // If the script exits 0, the test should fail because it should detect the missing file.
  throw new Error('Expected link checker to fail on missing local file');
} catch (err) {
  const out = err.stdout ? err.stdout.toString() : '';
  const e = err.stderr ? err.stderr.toString() : '';
  // success path: process exited non-zero
  assert.ok((out + e).includes('missing ./non-existent.md') || (out + e).includes('Problems in'), 'Link checker did not report the expected missing file');
}

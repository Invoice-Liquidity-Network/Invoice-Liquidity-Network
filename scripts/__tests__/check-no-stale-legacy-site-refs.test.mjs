import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateNoStaleLegacySiteRefs } from '../operations/check-no-stale-legacy-site-refs.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Stale Legacy-Site References Suite (#1291)', () => {
  it('validates canonical DOCS_SETUP.md and confirms no stale legacy-site references exist', () => {
    const res = validateNoStaleLegacySiteRefs();
    assert.equal(res.valid, true);
    assert.equal(res.violationsCount, 0);
    assert.ok(res.sha256.length === 64);
  });

  it('fails closed when a doc references deploying the legacy docs/pages directory', () => {
    const tempFile = join(__dirname, 'mock-stale-docs.md');
    const mockContent = 'To deploy, please deploy docs/pages to vercel';
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = validateNoStaleLegacySiteRefs(tempFile);
      assert.equal(res.valid, false);
      assert.ok(res.violations.some((v) => v.reason.includes('Stale reference')));
    } finally {
      unlinkSync(tempFile);
    }
  });
});

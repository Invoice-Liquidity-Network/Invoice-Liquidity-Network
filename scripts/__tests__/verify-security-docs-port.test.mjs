import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifySecurityDocsPort } from '../operations/verify-security-docs-port.mjs';

describe('Security & Threat-Model Documentation Port Suite (#1287)', () => {
  it('validates ported MDX files and checked status in DOCS_SETUP.md', () => {
    const res = verifySecurityDocsPort();
    assert.equal(res.valid, true);
    assert.equal(res.violationsCount, 0);
    assert.ok(res.sha256.length === 64);
  });
});

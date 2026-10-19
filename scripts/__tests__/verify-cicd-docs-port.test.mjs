import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCicdDocsPort } from '../operations/verify-cicd-docs-port.mjs';

describe('CI/CD Documentation Port Suite (#1286)', () => {
  it('validates ported ci-cd.mdx and checked status in DOCS_SETUP.md', () => {
    const res = verifyCicdDocsPort();
    assert.equal(res.valid, true);
    assert.equal(res.violationsCount, 0);
    assert.ok(res.sha256.length === 64);
  });
});

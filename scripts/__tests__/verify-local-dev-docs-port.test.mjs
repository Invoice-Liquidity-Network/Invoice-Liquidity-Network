import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyLocalDevDocsPort } from '../operations/verify-local-dev-docs-port.mjs';

describe('Local Development Documentation Port Suite (#1285)', () => {
  it('validates ported local-development.mdx and checked status in DOCS_SETUP.md', () => {
    const res = verifyLocalDevDocsPort();
    assert.equal(res.valid, true);
    assert.equal(res.violationsCount, 0);
    assert.ok(res.sha256.length === 64);
  });
});

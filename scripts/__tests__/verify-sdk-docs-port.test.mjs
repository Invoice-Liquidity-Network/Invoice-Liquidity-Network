import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifySdkDocsPort } from '../operations/verify-sdk-docs-port.mjs';

describe('SDK & E2E Documentation Port Suite (#1290)', () => {
  it('validates all 4 ported SDK MDX files and checked status in DOCS_SETUP.md', () => {
    const res = verifySdkDocsPort();
    assert.equal(res.valid, true);
    assert.equal(res.violationsCount, 0);
    assert.ok(res.sha256.length === 64);
  });
});

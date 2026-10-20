import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runConsumerInstallAudit } from '../operations/test-consumer-install-resolution.mjs';

describe('Clean Consumer Install Resolution Suite (#1223)', () => {
  it('validates self-contained package manifests and clean consumer install resolution', () => {
    const res = runConsumerInstallAudit();
    assert.equal(res.allPassed, true);
    assert.equal(res.report.status, 'CLEAN_INSTALL_VERIFIED');
    assert.equal(res.report.violationsCount, 0);
    assert.equal(res.report.packagesAudited.length, 2);
    assert.ok(res.sha256.length === 64);
  });
});

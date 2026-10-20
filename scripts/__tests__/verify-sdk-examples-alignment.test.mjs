import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runExamplesAlignmentAudit } from '../operations/verify-sdk-examples-alignment.mjs';

describe('SDK Examples Package Alignment Suite (#1220)', () => {
  it('validates canonical package names across all example directories and emits verified audit report', () => {
    const res = runExamplesAlignmentAudit();
    assert.equal(res.allPassed, true);
    assert.equal(res.report.status, 'EXAMPLES_ALIGNED');
    assert.equal(res.report.violationsCount, 0);
    assert.ok(res.report.scannedExamplesCount > 0);
    assert.ok(res.sha256.length === 64);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditMainnetOperationalReadiness,
  MAINNET_CONTROLS_SPEC,
} from '../operations/operational-readiness-review.mjs';

describe('Operational Readiness Review for Mainnet Controls (#1324)', () => {
  it('contains comprehensive control specs across Security, Operations, and Observability', () => {
    assert.ok(MAINNET_CONTROLS_SPEC.length >= 7);
    const categories = new Set(MAINNET_CONTROLS_SPEC.map((s) => s.category));
    assert.ok(categories.has('Security'));
    assert.ok(categories.has('Operations'));
    assert.ok(categories.has('Observability'));
  });

  it('evaluates current repository state and confirms 100% readiness pass rate', () => {
    const report = auditMainnetOperationalReadiness();
    assert.equal(report.failedControls, 0);
    assert.equal(report.passRatePercent, 100);
    assert.equal(report.signOffEligible, true);
    assert.equal(report.readinessStatus, 'MAINNET_READY');
  });

  it('fails closed when required control files are missing', () => {
    const mockReport = auditMainnetOperationalReadiness('/non/existent/path');
    assert.equal(mockReport.signOffEligible, false);
    assert.equal(mockReport.passedControls, 0);
    assert.equal(mockReport.readinessStatus, 'READINESS_GAPS_DETECTED');
  });
});

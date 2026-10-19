import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOnCallHandoff,
  REQUIRED_SEVERITY_TIERS,
  REQUIRED_DOMAINS,
  REQUIRED_HANDOFF_CHECKS,
} from '../operations/check-oncall-handoff.mjs';

describe('On-Call Escalation & Handoff Checklist Suite (#1329)', () => {
  it('validates canonical on-call escalation and handoff checklist document', () => {
    const res = validateOnCallHandoff();
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
    assert.equal(res.severityTiersCount, REQUIRED_SEVERITY_TIERS.length);
    assert.equal(res.domainsCoveredCount, REQUIRED_DOMAINS.length);
    assert.equal(res.handoffChecksCount, REQUIRED_HANDOFF_CHECKS.length);
    assert.ok(res.sha256.length === 64);
  });

  it('fails closed when missing required severity tiers or checklist points', () => {
    assert.throws(
      () => validateOnCallHandoff('/non/existent/doc.md'),
      /On-call escalation doc not found/
    );
  });
});

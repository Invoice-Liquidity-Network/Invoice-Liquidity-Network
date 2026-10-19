import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LaunchReadinessExceptionEvaluator,
  PROHIBITED_EXCEPTION_ITEMS,
  REQUIRED_SIGNERS,
} from '../operations/launch-readiness-exception-evaluator.mjs';

describe('Launch Readiness Exception Process Suite (#1302)', () => {
  const evaluator = new LaunchReadinessExceptionEvaluator();

  it('rejects waivers on prohibited existential security invariants', () => {
    for (const item of PROHIBITED_EXCEPTION_ITEMS) {
      const res = evaluator.evaluateExceptionRequest({
        item,
        category: 'Security',
        rationale: 'Trying to launch early',
        compensatingControls: 'Extensive internal testing and monitoring',
        ttlDays: 5,
        signers: REQUIRED_SIGNERS,
      });

      assert.equal(res.approved, false);
      assert.equal(res.rejectionCode, 'PROHIBITED_INVARIANT_WAIVER');
    }
  });

  it('rejects exception requests lacking unanimous lead quorum', () => {
    const res = evaluator.evaluateExceptionRequest({
      item: 'Optional UI Polish',
      category: 'Frontend',
      rationale: 'Deferred feature',
      compensatingControls: 'Fallback banner rendered and tested in staging',
      ttlDays: 5,
      signers: ['@security-lead'], // missing protocol & release leads
    });

    assert.equal(res.approved, false);
    assert.equal(res.rejectionCode, 'INSUFFICIENT_SIGNER_QUORUM');
  });

  it('approves permissible waiver with valid compensating controls and generates signed certificate', () => {
    const res = evaluator.evaluateExceptionRequest({
      item: 'Optional Non-Critical Benchmark',
      category: 'Performance',
      rationale: 'Staging cluster migration delayed secondary benchmark',
      compensatingControls: 'Local baseline benchmarks completed and certified by QA lead',
      ttlDays: 7,
      signers: REQUIRED_SIGNERS,
    });

    assert.equal(res.approved, true);
    assert.ok(res.certificate !== null);
    assert.ok(res.certificate.sha256.length === 64);
    assert.equal(res.certificate.ttlDays, 7);
  });
});

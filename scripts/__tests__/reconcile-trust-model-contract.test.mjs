import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditTrustModelReconciliation,
  RECONCILIATION_CLAIMS,
} from '../operations/reconcile-trust-model-contract.mjs';

describe('Trust Model Contract Reconciliation Suite (#1312)', () => {
  it('verifies all architectural claims are reconciled with smart contract invariants', () => {
    const res = auditTrustModelReconciliation();
    assert.equal(res.valid, true);
    assert.equal(res.discrepancies.length, 0);
    assert.equal(res.reconciledClaimsCount, RECONCILIATION_CLAIMS.length);
    assert.ok(res.sha256.length === 64);
  });

  it('fails closed when reconciliation document is missing', () => {
    assert.throws(
      () => auditTrustModelReconciliation('/non/existent/doc.md'),
      /Reconciliation document not found/
    );
  });
});

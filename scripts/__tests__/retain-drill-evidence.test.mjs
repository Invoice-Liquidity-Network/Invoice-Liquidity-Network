import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDrillEvidenceBundle,
  verifyDrillEvidence,
  computeEvidenceHash,
} from '../drills/retain-drill-evidence.mjs';

describe('Launch-Critical Drill Evidence Retention Suite (#1322)', () => {
  it('builds a cryptographically signed drill evidence bundle', () => {
    const drillResult = {
      drillId: 'DRILL-RPC-FAILOVER-01',
      drillName: 'Stellar RPC Node Outage Failover Drill',
      scenario: 'PRIMARY_RPC_PARTITION',
      containmentDurationMs: 320,
      recoveryDurationMs: 850,
      success: true,
      metrics: {
        failoverAttempts: 1,
        activeEndpoint: 'https://soroban-backup.stellar.org',
      },
    };

    const bundle = buildDrillEvidenceBundle(drillResult, { operator: '@infra-lead' });
    assert.equal(bundle.drillId, 'DRILL-RPC-FAILOVER-01');
    assert.equal(bundle.status, 'PASS');
    assert.equal(bundle.retentionDays, 90);
    assert.ok(bundle.sha256.length === 64);
    assert.equal(bundle.verified, true);
  });

  it('verifies untampered evidence bundles with matching hashes and active retention', () => {
    const bundle = buildDrillEvidenceBundle({
      drillId: 'DRILL-CIRCUIT-BREAKER-01',
      drillName: 'Emergency Feature Disable Drill',
      success: true,
    });

    const verification = verifyDrillEvidence(bundle);
    assert.equal(verification.valid, true);
    assert.equal(verification.hashMatches, true);
    assert.equal(verification.isNotExpired, true);
  });

  it('detects and rejects tampered evidence payloads', () => {
    const bundle = buildDrillEvidenceBundle({
      drillId: 'DRILL-TAMPER-TEST',
      success: true,
    });

    // Tamper with duration
    const tampered = { ...bundle, containmentDurationMs: 999999 };
    const verification = verifyDrillEvidence(tampered);
    assert.equal(verification.valid, false);
    assert.equal(verification.hashMatches, false);
  });
});

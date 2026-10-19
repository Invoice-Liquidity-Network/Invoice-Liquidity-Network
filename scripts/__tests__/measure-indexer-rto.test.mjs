import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IndexerRtoBenchmark, DEFAULT_INDEXER_RTO_TARGET_SECONDS } from '../operations/measure-indexer-rto.mjs';

describe('Indexer Recovery Time Objective Suite (#1317)', () => {
  it('benchmarks cold restore and proves RTO ≤ 300s target is met', () => {
    const bench = new IndexerRtoBenchmark();
    const res = bench.simulateRestoration(5000, 50);

    assert.equal(res.integrityValid, true);
    assert.ok(res.totalDurationSeconds < DEFAULT_INDEXER_RTO_TARGET_SECONDS);
    assert.equal(res.rtoMet, true);
    assert.equal(res.rpoMet, true);
  });

  it('runs benchmark and outputs cryptographically signed evidence artifact', () => {
    const bench = new IndexerRtoBenchmark();
    const output = bench.runAndRetainEvidence('@infra-lead');

    assert.equal(output.evidenceBundle.status, 'PASS');
    assert.ok(output.evidenceBundle.sha256.length === 64);
    assert.equal(output.evidenceBundle.retentionDays, 90);
  });
});

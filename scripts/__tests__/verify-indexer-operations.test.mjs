import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateIndexerHealthProbe,
  evaluateCursorLag,
  runIndexerOperationsAudit,
  MAX_ALLOWED_LEDGER_LAG,
} from '../operations/verify-indexer-operations.mjs';

describe('Indexer Operations Executable Checks Suite (#1288)', () => {
  it('validates healthy indexer probe response', () => {
    const res = evaluateIndexerHealthProbe({ status: 'ok', uptime: 1200, synced: true });
    assert.equal(res.healthy, true);
  });

  it('detects excessive ledger lag and fails closed', () => {
    const res = evaluateCursorLag(100, 80); // 20 ledgers lag (>10)
    assert.equal(res.valid, false);
    assert.equal(res.lag, 20);
    assert.ok(res.reason.includes('exceeds max allowed budget'));
  });

  it('runs complete indexer operations audit and outputs verified cryptographic report', () => {
    const audit = runIndexerOperationsAudit();
    assert.equal(audit.allPassed, true);
    assert.equal(audit.report.status, 'OPERATIONS_READY');
    assert.equal(audit.report.checks.length, 4);
    assert.ok(audit.sha256.length === 64);
  });
});

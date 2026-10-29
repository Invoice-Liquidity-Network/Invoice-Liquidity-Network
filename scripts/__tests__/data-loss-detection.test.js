import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDataLossDetection, DATA_LOSS_DETECTION_SIGNALS } from '../detect-data-loss.mjs';

describe('Automated Data-Loss Detection Suite (#1108)', () => {
  it('passes all checks when system state is healthy and synchronized', () => {
    const now = Date.now();
    const healthyContext = {
      latestOnChainLedger: 10000,
      indexerProcessedLedger: 9990,
      onChainStateHash: '0xhash123',
      dbStateHash: '0xhash123',
      emittedEventsCount: 500,
      persistedEventsCount: 500,
      oraclePayloadValid: true,
      oracleTimestampMs: now - 5000,
      currentTimestampMs: now,
    };

    const report = runDataLossDetection(healthyContext);
    assert.equal(report.activeAlertsCount, 0);
    assert.equal(report.passedCount, 4);
  });

  it('triggers SIG-DL-001 when indexer ledger sequence gap exceeds threshold', () => {
    const now = Date.now();
    const laggingContext = {
      latestOnChainLedger: 10000,
      indexerProcessedLedger: 9900, // gap of 100 > 50
      onChainStateHash: '0xhash123',
      dbStateHash: '0xhash123',
      emittedEventsCount: 500,
      persistedEventsCount: 500,
      oraclePayloadValid: true,
      oracleTimestampMs: now - 5000,
      currentTimestampMs: now,
    };

    const report = runDataLossDetection(laggingContext);
    assert.equal(report.activeAlertsCount, 1);
    const alert = report.activeAlerts[0];
    assert.equal(alert.signalId, 'SIG-DL-001');
    assert.equal(alert.triggered, true);
    assert.ok(alert.message.includes('CRITICAL: Indexer is lagging'));
  });

  it('triggers SIG-DL-002 on storage state snapshot hash mismatch', () => {
    const now = Date.now();
    const stateDriftContext = {
      latestOnChainLedger: 10000,
      indexerProcessedLedger: 9995,
      onChainStateHash: '0xonchain_root',
      dbStateHash: '0xdb_root_mismatch',
      emittedEventsCount: 500,
      persistedEventsCount: 500,
      oraclePayloadValid: true,
      oracleTimestampMs: now - 5000,
      currentTimestampMs: now,
    };

    const report = runDataLossDetection(stateDriftContext);
    const alert = report.activeAlerts.find((a) => a.signalId === 'SIG-DL-002');
    assert.ok(alert);
    assert.equal(alert.triggered, true);
    assert.ok(alert.message.includes('On-chain state hash'));
  });

  it('triggers SIG-DL-003 on stale or invalid oracle payload', () => {
    const now = Date.now();
    const staleOracleContext = {
      latestOnChainLedger: 10000,
      indexerProcessedLedger: 9995,
      onChainStateHash: '0xhash123',
      dbStateHash: '0xhash123',
      emittedEventsCount: 500,
      persistedEventsCount: 500,
      oraclePayloadValid: false,
      oracleTimestampMs: now - 120_000, // 2 minutes old
      currentTimestampMs: now,
    };

    const report = runDataLossDetection(staleOracleContext);
    const alert = report.activeAlerts.find((a) => a.signalId === 'SIG-DL-003');
    assert.ok(alert);
    assert.equal(alert.triggered, true);
    assert.ok(alert.message.includes('Oracle payload invalid'));
  });
});

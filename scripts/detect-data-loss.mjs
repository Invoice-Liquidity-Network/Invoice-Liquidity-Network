#!/usr/bin/env node

/**
 * Automated Data-Loss & Data-Integrity Detection Tool (#1108)
 *
 * Retroactively designs and executes concrete detection signals derived from
 * past near-miss incident history to proactively catch data loss, event skips,
 * or state corruption.
 */

import { fileURLToPath } from 'node:url';

export const DATA_LOSS_DETECTION_SIGNALS = [
  {
    id: 'SIG-DL-001',
    name: 'Indexer Ledger Sequence Gap Detection',
    provenanceIncident: 'NM-2026-02 (Indexer Event Lag)',
    severity: 'critical',
    category: 'block-gap',
    description: 'Catches unindexed block gaps between Soroban ledger head and indexer state.',
    check: (ctx) => {
      const gap = ctx.latestOnChainLedger - ctx.indexerProcessedLedger;
      const threshold = 50;
      const triggered = gap > threshold;
      return {
        triggered,
        metricValue: gap,
        threshold,
        message: triggered
          ? `CRITICAL: Indexer is lagging behind ledger head by ${gap} ledgers (threshold: ${threshold}). Risk of missed event ingestion.`
          : `OK: Indexer ledger gap is ${gap} ledgers.`,
      };
    },
  },
  {
    id: 'SIG-DL-002',
    name: 'Storage State Hash Snapshot Drift Detection',
    provenanceIncident: 'NM-2026-04 (Storage State Mismatch)',
    severity: 'critical',
    category: 'state-drift',
    description: 'Verifies on-chain Soroban contract state root hash matches database indexed state hash.',
    check: (ctx) => {
      const triggered = ctx.onChainStateHash !== ctx.dbStateHash;
      return {
        triggered,
        metricValue: triggered ? 1 : 0,
        threshold: 0,
        message: triggered
          ? `CRITICAL: On-chain state hash (${ctx.onChainStateHash}) differs from DB state hash (${ctx.dbStateHash}). Data corruption or unhandled reorg detected!`
          : `OK: State root hashes match (${ctx.onChainStateHash}).`,
      };
    },
  },
  {
    id: 'SIG-DL-003',
    name: 'Oracle Price Payload Corruption Detection',
    provenanceIncident: 'NM-2026-05 (Stale Payload Verification)',
    severity: 'critical',
    category: 'payload-corruption',
    description: 'Detects malformed payload, signature invalidity, or stale timestamp in oracle responses.',
    check: (ctx) => {
      const ageMs = ctx.currentTimestampMs - ctx.oracleTimestampMs;
      const maxAgeMs = 60_000;
      const invalidPayload = !ctx.oraclePayloadValid;
      const staleTimestamp = ageMs > maxAgeMs;
      const triggered = invalidPayload || staleTimestamp;
      return {
        triggered,
        metricValue: ageMs,
        threshold: maxAgeMs,
        message: triggered
          ? `CRITICAL: Oracle payload invalid (valid=${ctx.oraclePayloadValid}) or stale (age=${ageMs}ms, max=${maxAgeMs}ms).`
          : `OK: Oracle payload is valid and fresh (${ageMs}ms old).`,
      };
    },
  },
  {
    id: 'SIG-DL-004',
    name: 'Unindexed Contract Event Drop Rate Detection',
    provenanceIncident: 'NM-2026-06 (Event Queue Backpressure Drop)',
    severity: 'warning',
    category: 'unindexed-event',
    description: 'Detects discrepancy between contract emitted events and indexer persisted events.',
    check: (ctx) => {
      const dropCount = ctx.emittedEventsCount - ctx.persistedEventsCount;
      const threshold = 0;
      const triggered = dropCount > threshold;
      return {
        triggered,
        metricValue: dropCount,
        threshold,
        message: triggered
          ? `WARNING: ${dropCount} contract events emitted but not persisted in database indexer.`
          : `OK: All ${ctx.emittedEventsCount} emitted events persisted correctly.`,
      };
    },
  },
];

export function runDataLossDetection(context) {
  const results = DATA_LOSS_DETECTION_SIGNALS.map((signal) => {
    const res = signal.check(context);
    return {
      signalId: signal.id,
      name: signal.name,
      provenance: signal.provenanceIncident,
      severity: signal.severity,
      ...res,
    };
  });

  const activeAlerts = results.filter((r) => r.triggered);
  return {
    timestamp: new Date().toISOString(),
    totalSignalsEvaluated: results.length,
    activeAlertsCount: activeAlerts.length,
    passedCount: results.length - activeAlerts.length,
    results,
    activeAlerts,
  };
}

// CLI execution handler
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Running automated data-loss detection signals (#1108)...');
  const now = Date.now();
  const sampleContext = {
    latestOnChainLedger: 10500,
    indexerProcessedLedger: 10495,
    onChainStateHash: '0xa1b2c3d4e5f6',
    dbStateHash: '0xa1b2c3d4e5f6',
    emittedEventsCount: 1500,
    persistedEventsCount: 1500,
    oraclePayloadValid: true,
    oracleTimestampMs: now - 10000,
    currentTimestampMs: now,
  };

  const report = runDataLossDetection(sampleContext);
  console.log(JSON.stringify(report, null, 2));
}

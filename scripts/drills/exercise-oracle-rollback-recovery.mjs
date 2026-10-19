#!/usr/bin/env node

/**
 * Exercise Oracle Rollback and Recovery Runbook Rehearsal (#1315)
 *
 * Implements end-to-end automated rehearsal of Scenario D (Oracle Compromise/Malfunction):
 * 1. Simulates cache poisoning / score inflation injection
 * 2. Executes frontend kill-switch gating (NEXT_PUBLIC_ORACLE_ENABLED = false)
 * 3. Purges poisoned oracle cache entries
 * 4. Rolls back container image tag to verified pre-incident digest
 * 5. Re-enables verification and confirms clean scoring
 * 6. Persists cryptographically signed evidence bundle
 */

import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildDrillEvidenceBundle, saveDrillEvidence } from './retain-drill-evidence.mjs';

export class OracleRollbackRehearsalSimulator {
  constructor() {
    this.cache = new Map();
    this.oracleEnabled = true;
    this.imageDigest = 'sha256:current-compromised-digest-abc123';
    this.operatorLog = [];

    // Seed poisoned cache entry
    this.cache.set('payer:FRAUDULENT_PAYER_XYZ', {
      score: 98,
      verified: true,
      flags: [],
      poisoned: true,
    });
  }

  isOracleEnabled() {
    return this.oracleEnabled;
  }

  queryPayer(payerAddress) {
    if (!this.oracleEnabled) {
      return {
        status: 'FALLBACK_STATIC_BOUNDS',
        oracleActive: false,
        score: 50, // default conservative baseline score
        verified: false,
        reason: 'Oracle service disabled by emergency kill-switch; smart contract fallback active.',
      };
    }

    const cached = this.cache.get(payerAddress);
    if (cached) {
      return {
        status: 'CACHED_ORACLE_RESPONSE',
        oracleActive: true,
        score: cached.score,
        verified: cached.verified,
        flags: cached.flags,
      };
    }

    return {
      status: 'FRESH_EVALUATION',
      oracleActive: true,
      score: 25,
      verified: false,
      flags: ['HIGH_RISK_NEW_PAYER'],
    };
  }

  executeEmergencyKillSwitch(operator = '@sec-commander') {
    const t0 = performance.now();
    this.oracleEnabled = false;
    this.operatorLog.push({
      action: 'DISABLE_ORACLE_KILL_SWITCH',
      operator,
      timestamp: new Date().toISOString(),
    });
    return {
      success: true,
      durationMs: performance.now() - t0,
    };
  }

  executeCachePurge(targetKey = null, operator = '@sec-commander') {
    const t0 = performance.now();
    if (targetKey) {
      this.cache.delete(targetKey);
    } else {
      this.cache.clear();
    }
    this.operatorLog.push({
      action: 'PURGE_ORACLE_CACHE',
      target: targetKey ?? 'ALL',
      operator,
      timestamp: new Date().toISOString(),
    });
    return {
      success: true,
      purgedCount: targetKey ? 1 : this.cache.size,
      durationMs: performance.now() - t0,
    };
  }

  executeImageRollback(safeDigest = 'sha256:verified-stable-digest-def456', operator = '@release-lead') {
    const t0 = performance.now();
    this.imageDigest = safeDigest;
    this.operatorLog.push({
      action: 'ROLLBACK_IMAGE_DIGEST',
      from: 'sha256:current-compromised-digest-abc123',
      to: safeDigest,
      operator,
      timestamp: new Date().toISOString(),
    });
    return {
      success: true,
      currentDigest: safeDigest,
      durationMs: performance.now() - t0,
    };
  }

  restoreOracleService(operator = '@sec-commander') {
    const t0 = performance.now();
    this.oracleEnabled = true;
    this.operatorLog.push({
      action: 'RESTORE_ORACLE_SERVICE',
      operator,
      timestamp: new Date().toISOString(),
    });
    return {
      success: true,
      durationMs: performance.now() - t0,
    };
  }

  runFullRehearsal(operator = '@sec-commander') {
    const startTime = performance.now();

    // 1. Detect poisoned query
    const initialCheck = this.queryPayer('payer:FRAUDULENT_PAYER_XYZ');
    if (initialCheck.score !== 98) {
      throw new Error('Precondition failed: poisoned state not observed.');
    }

    // 2. Kill switch
    const killSwitch = this.executeEmergencyKillSwitch(operator);

    // 3. Verify fallback state active
    const fallbackCheck = this.queryPayer('payer:FRAUDULENT_PAYER_XYZ');
    if (fallbackCheck.status !== 'FALLBACK_STATIC_BOUNDS') {
      throw new Error('Kill switch failed to engage static fallback.');
    }

    // 4. Purge cache & rollback image
    const purge = this.executeCachePurge('payer:FRAUDULENT_PAYER_XYZ', operator);
    const rollback = this.executeImageRollback('sha256:verified-stable-digest-def456', operator);

    // 5. Restore oracle
    const restore = this.restoreOracleService(operator);

    // 6. Verify fresh evaluation is clean and flags high risk
    const finalCheck = this.queryPayer('payer:FRAUDULENT_PAYER_XYZ');
    if (finalCheck.score > 30) {
      throw new Error(`Oracle recovery failed: score still inflated (${finalCheck.score})`);
    }

    const totalDurationMs = performance.now() - startTime;

    const evidenceBundle = buildDrillEvidenceBundle({
      drillId: 'DRILL-ORACLE-ROLLBACK-RECOVERY',
      drillName: 'Oracle Rollback and Recovery Rehearsal (#1315)',
      scenario: 'CACHE_POISONING_CONTAINMENT_AND_IMAGE_ROLLBACK',
      containmentDurationMs: killSwitch.durationMs,
      recoveryDurationMs: totalDurationMs,
      success: true,
      metrics: {
        killSwitchDurationMs: killSwitch.durationMs,
        purgeDurationMs: purge.durationMs,
        rollbackDurationMs: rollback.durationMs,
        restoreDurationMs: restore.durationMs,
        finalScore: finalCheck.score,
        stableImageDigest: rollback.currentDigest,
      },
    }, { operator });

    const evidencePath = saveDrillEvidence(evidenceBundle);

    return {
      success: true,
      evidenceBundle,
      evidencePath,
    };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Exercising Oracle Rollback and Recovery Runbook (#1315)...');
  const sim = new OracleRollbackRehearsalSimulator();
  const outcome = sim.runFullRehearsal();
  console.log(JSON.stringify(outcome.evidenceBundle, null, 2));
  console.log(`Evidence bundle persisted to: ${outcome.evidencePath}`);
}

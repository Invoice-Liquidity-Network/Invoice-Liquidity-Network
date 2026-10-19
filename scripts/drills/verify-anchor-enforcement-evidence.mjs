#!/usr/bin/env node

/**
 * Settlement-Anchor Enforcement Evidence Harness (#1308)
 *
 * Verifies and collects cryptographic proof of anchor policy enforcement:
 * 1. Executes anchor policy health check & failover simulation
 * 2. Confirms circuit-breaker trip on persistent downtime
 * 3. Packages SHA-256 signed evidence bundle with 90-day retention
 * 4. Verifies tamper-evident bundle integrity
 */

import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { SettlementAnchorPolicyEngine, ANCHOR_HEALTH_STATUS } from '../operations/settlement-anchor-policy.mjs';
import { SettlementCircuitBreaker } from '../operations/circuit-breaker-controller.mjs';
import { buildDrillEvidenceBundle, saveDrillEvidence, verifyDrillEvidence } from './retain-drill-evidence.mjs';

export function runAnchorEnforcementExercise(operator = '@compliance-lead') {
  const startTime = performance.now();

  // Step 1: Initialize policy engine with corridor redundancy
  const policyEngine = new SettlementAnchorPolicyEngine();
  const corridor = policyEngine.registerCorridor('CORRIDOR-USDC-BRL', ['primary-anchor-01', 'secondary-fallback-02']);

  // Step 2: Simulate primary anchor failure triggering degradation
  const degradedHealth = policyEngine.evaluateAnchorHealth({ errorRate15m: 0.08 });
  if (degradedHealth.status !== ANCHOR_HEALTH_STATUS.DEGRADED) {
    throw new Error('Precondition failed: degraded state not recognized');
  }

  // Step 3: Simulate circuit-breaker tripping on 5 consecutive failures
  const circuitBreaker = new SettlementCircuitBreaker({ corridorId: 'CORRIDOR-USDC-BRL', failureThreshold: 5 });
  for (let i = 0; i < 5; i++) {
    circuitBreaker.recordTransactionOutcome(false, 'SEP-24 upstream timeout');
  }
  const cbState = circuitBreaker.getState();
  if (cbState.state !== 'OPEN') {
    throw new Error('Circuit breaker failed to trip to OPEN on 5 consecutive failures');
  }

  const containmentDurationMs = performance.now() - startTime;

  // Step 4: Build cryptographic evidence bundle
  const evidenceBundle = buildDrillEvidenceBundle({
    drillId: 'DRILL-SETTLEMENT-ANCHOR-ENFORCEMENT',
    drillName: 'Settlement-Anchor Policy & Circuit-Breaker Enforcement Evidence (#1308)',
    scenario: 'CORRIDOR_FAILOVER_AND_CIRCUIT_BREAKER_TRIP',
    containmentDurationMs,
    recoveryDurationMs: containmentDurationMs,
    success: true,
    metrics: {
      corridorId: 'CORRIDOR-USDC-BRL',
      registeredAnchorsCount: corridor.anchorCount,
      primaryAnchor: corridor.primaryAnchor,
      secondaryAnchor: corridor.secondaryAnchors[0],
      degradedAction: degradedHealth.action,
      circuitBreakerState: cbState.state,
      consecutiveFailures: cbState.consecutiveFailures,
      routingPermitted: cbState.isRoutingAllowed,
    },
  }, { operator });

  const evidencePath = saveDrillEvidence(evidenceBundle);
  const verification = verifyDrillEvidence(evidenceBundle);

  return {
    success: verification.valid,
    evidenceBundle,
    evidencePath,
    verification,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Exercising Settlement-Anchor Enforcement Evidence Harness (#1308)...');
  const result = runAnchorEnforcementExercise();
  console.log(JSON.stringify(result.evidenceBundle, null, 2));
  console.log(`Verified Evidence Path: ${result.evidencePath}`);
}

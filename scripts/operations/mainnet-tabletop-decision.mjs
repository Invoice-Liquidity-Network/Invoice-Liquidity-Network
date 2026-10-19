#!/usr/bin/env node

/**
 * Independent Mainnet Go/No-Go Tabletop Decision Engine (#1330)
 *
 * Implements the programmatic, multi-role decision matrix and tabletop
 * evaluation logic for ILN mainnet launch approval.
 * Enforces strict fail-closed criteria across Protocol, Security, Infrastructure,
 * SDK, and Release roles.
 */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DECISION_ROLES = [
  'PROTOCOL_LEAD',
  'SECURITY_LEAD',
  'INFRASTRUCTURE_LEAD',
  'SDK_LEAD',
  'RELEASE_LEAD',
];

export function computeDecisionHash(decisionRecord) {
  const normalized = JSON.stringify(decisionRecord, Object.keys(decisionRecord).sort());
  return createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

export function evaluateGoNoGoDecision(signals, evaluator = 'Independent Tabletop Facilitator') {
  const blockingReasons = [];
  const votes = {};

  // 1. Security Gate
  if (signals.criticalVulnerabilitiesCount > 0) {
    blockingReasons.push(`${signals.criticalVulnerabilitiesCount} unresolved critical/high vulnerabilities`);
    votes.SECURITY_LEAD = 'NO-GO';
  } else if (!signals.externalAuditRemediated) {
    blockingReasons.push('External security audit remediations incomplete');
    votes.SECURITY_LEAD = 'NO-GO';
  } else {
    votes.SECURITY_LEAD = 'GO';
  }

  // 2. Protocol & Smart Contracts Gate
  if (!signals.contractUpgradeTested) {
    blockingReasons.push('Contract storage upgrade verification incomplete');
    votes.PROTOCOL_LEAD = 'NO-GO';
  } else if (!signals.emergencyPauseRehearsed) {
    blockingReasons.push('Emergency circuit breaker pause/unpause unverified');
    votes.PROTOCOL_LEAD = 'NO-GO';
  } else {
    votes.PROTOCOL_LEAD = 'GO';
  }

  // 3. Infrastructure & Network Gate
  if (!signals.rpcFailoverTested) {
    blockingReasons.push('Stellar RPC node failover and outage drills unverified');
    votes.INFRASTRUCTURE_LEAD = 'NO-GO';
  } else if (!signals.canarySoakClean) {
    blockingReasons.push('Canary soak period had unresolved SLI breaches');
    votes.INFRASTRUCTURE_LEAD = 'NO-GO';
  } else {
    votes.INFRASTRUCTURE_LEAD = 'GO';
  }

  // 4. SDK & Client Integration Gate
  if (signals.breakingXdrMutations) {
    blockingReasons.push('Unannounced breaking XDR serialization changes detected in SDK');
    votes.SDK_LEAD = 'NO-GO';
  } else {
    votes.SDK_LEAD = 'GO';
  }

  // 5. Release & Operational Gate
  if (signals.unresolvedSev1Incidents > 0) {
    blockingReasons.push(`${signals.unresolvedSev1Incidents} active SEV-1 incidents pending postmortem`);
    votes.RELEASE_LEAD = 'NO-GO';
  } else {
    votes.RELEASE_LEAD = 'GO';
  }

  const isGo = blockingReasons.length === 0;
  const decisionRecord = {
    evaluator,
    timestamp: new Date().toISOString(),
    verdict: isGo ? 'GO' : 'NO-GO',
    unanimous: isGo,
    votes,
    blockingReasons,
    signalsSnapshot: signals,
  };

  const sha256 = computeDecisionHash(decisionRecord);

  return {
    ...decisionRecord,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Executing Independent Mainnet Go/No-Go Tabletop Decision (#1330)...');
  const cleanSignals = {
    criticalVulnerabilitiesCount: 0,
    externalAuditRemediated: true,
    contractUpgradeTested: true,
    emergencyPauseRehearsed: true,
    rpcFailoverTested: true,
    canarySoakClean: true,
    breakingXdrMutations: false,
    unresolvedSev1Incidents: 0,
  };
  const decision = evaluateGoNoGoDecision(cleanSignals);
  console.log(JSON.stringify(decision, null, 2));
}

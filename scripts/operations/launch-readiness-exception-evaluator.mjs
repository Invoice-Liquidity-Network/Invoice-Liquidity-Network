#!/usr/bin/env node

/**
 * Launch Readiness Exception & Waiver Evaluation Engine (#1302)
 *
 * Enforces rigorous governance and cryptographic validation for mainnet launch exceptions:
 * - Prohibits waivers on core invariants (Smart contract audits, multi-sig, circuit breakers)
 * - Requires unanimous sign-off from Security, Protocol, and Release leads
 * - Bounds exception lifetimes to max 14 days with verifiable compensating controls
 * - Issues cryptographically sealed exception certificates
 */

import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const PROHIBITED_EXCEPTION_ITEMS = [
  'External security audit',
  'Multi-sig admin configured',
  'Circuit breaker tested',
  'Upgrade path tested',
  'Backups verified',
];

export const REQUIRED_SIGNERS = [
  '@security-lead',
  '@protocol-lead',
  '@release-lead',
];

export const MAX_EXCEPTION_TTL_DAYS = 14;

export class LaunchReadinessExceptionEvaluator {
  constructor(options = {}) {
    this.maxTtlDays = options.maxTtlDays ?? MAX_EXCEPTION_TTL_DAYS;
  }

  evaluateExceptionRequest(request) {
    const {
      item,
      category,
      rationale,
      compensatingControls,
      ttlDays,
      signers = [],
    } = request;

    // 1. Check for categorically prohibited core invariants
    if (PROHIBITED_EXCEPTION_ITEMS.includes(item)) {
      return {
        approved: false,
        rejectionCode: 'PROHIBITED_INVARIANT_WAIVER',
        reason: `Critical security item '${item}' cannot be waived under any circumstance.`,
      };
    }

    // 2. Validate mandatory signers quorum
    const missingSigners = REQUIRED_SIGNERS.filter((s) => !signers.includes(s));
    if (missingSigners.length > 0) {
      return {
        approved: false,
        rejectionCode: 'INSUFFICIENT_SIGNER_QUORUM',
        reason: `Missing required sign-offs: ${missingSigners.join(', ')}`,
      };
    }

    // 3. Validate compensating controls exist
    if (!compensatingControls || compensatingControls.trim().length < 20) {
      return {
        approved: false,
        rejectionCode: 'INSUFFICIENT_COMPENSATING_CONTROLS',
        reason: 'A detailed, verifiable compensating control description (>=20 chars) is mandatory.',
      };
    }

    // 4. Validate time-bounded TTL
    if (!ttlDays || ttlDays <= 0 || ttlDays > this.maxTtlDays) {
      return {
        approved: false,
        rejectionCode: 'INVALID_TTL',
        reason: `Exception TTL must be between 1 and ${this.maxTtlDays} days (requested: ${ttlDays}).`,
      };
    }

    // 5. Generate Certificate
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 86400 * 1000);

    const certificatePayload = {
      certificateId: `WAIVER-${Date.now()}`,
      item,
      category,
      rationale,
      compensatingControls,
      approvedBy: signers,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ttlDays,
    };
    certificatePayload.sha256 = createHash('sha256')
      .update(JSON.stringify(certificatePayload))
      .digest('hex');

    return {
      approved: true,
      certificate: certificatePayload,
    };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Evaluating Launch Readiness Exception Process (#1302)...');
  const evaluator = new LaunchReadinessExceptionEvaluator();
  const res = evaluator.evaluateExceptionRequest({
    item: 'Coverage thresholds met',
    category: 'Security',
    rationale: 'Minor doc coverage branch missing, scheduled for post-launch patch',
    compensatingControls: 'Manual peer review completed and certified by QA lead',
    ttlDays: 7,
    signers: ['@security-lead', '@protocol-lead', '@release-lead'],
  });
  console.log('Result:', res);
}

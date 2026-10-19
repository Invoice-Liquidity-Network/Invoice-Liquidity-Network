#!/usr/bin/env node

/**
 * Withdrawal Queue Behavior for Illiquid Positions (#1303)
 *
 * Governs redemption queue mechanics when liquidity pool underlying assets
 * transition into illiquid, defaulted, or workout states (docs/trust-liquidity-model.md Sec 6):
 *
 * Invariants:
 * 1. Performing Cash Exhaustion Gating: Cash redemptions pause when performing liquidity hits zero.
 * 2. Anti-Bank-Run Parity: First-in queue CANNOT extract 100% performing cash if it leaves
 *    subsequent LPs holding 100% illiquid defaulted debt.
 * 3. Contingent Recovery Receipts (CRRs): Unfulfillable illiquid claims convert into sidecar CRRs.
 * 4. Pro-Rata Workout Recovery: Subsequent legal/debt workout recoveries disburse pro-rata to CRR holders.
 */

import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export class IlliquidPositionQueueHandler {
  constructor(initialAssets = {}) {
    this.performingCash = initialAssets.performingCash ?? 100_000.0;
    this.illiquidLoanPrincipal = initialAssets.illiquidLoanPrincipal ?? 200_000.0;
    this.totalPoolShares = initialAssets.totalPoolShares ?? 300_000.0;
    this.crrRegistry = new Map();
    this.nextCrrId = 1;
  }

  processQueueWithdrawal(ticketId, requestedAmount) {
    if (requestedAmount <= 0) throw new Error('Requested amount must be positive');

    // Calculate maximum allowable cash disbursement to preserve pool parity
    // An LP cannot extract more than their pro-rata share of performing cash
    const performingRatio = this.performingCash / (this.performingCash + this.illiquidLoanPrincipal);
    const maxCashEntitlement = requestedAmount * performingRatio;

    const cashDisbursed = Math.min(this.performingCash, maxCashEntitlement);
    this.performingCash -= cashDisbursed;

    const illiquidPortion = requestedAmount - cashDisbursed;
    let crr = null;

    if (illiquidPortion > 0) {
      const crrId = `CRR-${this.nextCrrId++}`;
      const crrPayload = {
        crrId,
        ticketId,
        faceValue: illiquidPortion,
        issuedAt: new Date().toISOString(),
        status: 'PENDING_WORKOUT_RECOVERY',
      };
      crrPayload.sha256 = createHash('sha256').update(JSON.stringify(crrPayload)).digest('hex');
      this.crrRegistry.set(crrId, crrPayload);
      crr = crrPayload;
    }

    return {
      ticketId,
      requestedAmount,
      cashDisbursed: Math.round(cashDisbursed * 100) / 100,
      illiquidPortion: Math.round(illiquidPortion * 100) / 100,
      crrIssued: crr,
      remainingPerformingCash: Math.round(this.performingCash * 100) / 100,
    };
  }

  disburseWorkoutRecovery(recoveredAmount) {
    if (recoveredAmount <= 0) throw new Error('Recovered amount must be positive');

    const totalCrrFaceValue = Array.from(this.crrRegistry.values())
      .filter((c) => c.status === 'PENDING_WORKOUT_RECOVERY')
      .reduce((acc, c) => acc + c.faceValue, 0);

    if (totalCrrFaceValue === 0) {
      return {
        recoveredAmount,
        disbursed: 0,
        surplus: recoveredAmount,
        crrsSatisfied: 0,
      };
    }

    const recoveryFactor = Math.min(1.0, recoveredAmount / totalCrrFaceValue);
    const distributions = [];

    for (const [id, crr] of this.crrRegistry.entries()) {
      if (crr.status === 'PENDING_WORKOUT_RECOVERY') {
        const payout = crr.faceValue * recoveryFactor;
        crr.recoveredAmount = payout;
        crr.status = recoveryFactor >= 1.0 ? 'FULLY_RECOVERED' : 'PARTIALLY_RECOVERED';
        distributions.push({
          crrId: id,
          payout: Math.round(payout * 100) / 100,
          status: crr.status,
        });
      }
    }

    this.illiquidLoanPrincipal = Math.max(0, this.illiquidLoanPrincipal - recoveredAmount);

    return {
      recoveredAmount,
      totalCrrFaceValue,
      recoveryPercent: Math.round(recoveryFactor * 1000) / 10,
      distributionsCount: distributions.length,
      distributions,
    };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Testing Illiquid Position Queue Handler (#1303)...');
  const handler = new IlliquidPositionQueueHandler();
  const res = handler.processQueueWithdrawal('TICKET-01', 90_000);
  console.log('Processed withdrawal:', res);
}

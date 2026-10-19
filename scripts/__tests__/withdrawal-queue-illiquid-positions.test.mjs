import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IlliquidPositionQueueHandler } from '../operations/illiquid-position-queue-handler.mjs';

describe('Illiquid Position Withdrawal Queue Suite (#1303)', () => {
  it('enforces pro-rata cash vs illiquid split preventing full-cash drain', () => {
    // 100k cash, 200k illiquid loans -> 33.3% performing cash ratio
    const handler = new IlliquidPositionQueueHandler({ performingCash: 100_000, illiquidLoanPrincipal: 200_000 });
    const res = handler.processQueueWithdrawal('TICKET-1', 90_000);

    // LP gets 30k cash (33.3% of 90k) and 60k CRR
    assert.equal(res.cashDisbursed, 30_000);
    assert.equal(res.illiquidPortion, 60_000);
    assert.ok(res.crrIssued !== null);
    assert.equal(res.crrIssued.faceValue, 60_000);
    assert.equal(res.remainingPerformingCash, 70_000);
  });

  it('disburses subsequent debt workout recoveries pro-rata to CRR holders', () => {
    // Zero performing cash to test pure illiquid CRR issuance
    const handler = new IlliquidPositionQueueHandler({ performingCash: 0, illiquidLoanPrincipal: 200_000 });
    handler.processQueueWithdrawal('TICKET-A', 60_000); // 60k CRR
    handler.processQueueWithdrawal('TICKET-B', 40_000); // 40k CRR
    // Total CRR face value = 100,000

    // Recover 50,000 from debtor liquidation (50% recovery)
    const workout = handler.disburseWorkoutRecovery(50_000);
    assert.equal(workout.recoveryPercent, 50.0);
    assert.equal(workout.distributionsCount, 2);
    assert.equal(workout.distributions[0].payout, 30_000); // 50% of 60k
    assert.equal(workout.distributions[1].payout, 20_000); // 50% of 40k
  });
});

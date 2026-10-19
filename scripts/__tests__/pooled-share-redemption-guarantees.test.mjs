import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PooledShareRedemptionEngine, REDEMPTION_GUARANTEE_CODES } from '../operations/pooled-share-redemption-policy.mjs';

describe('Pooled-Share Redemption Guarantees Suite (#1305)', () => {
  it('guarantees 100% immediate par fulfillment when requested value <= idle cash', () => {
    const engine = new PooledShareRedemptionEngine({ idleCashBalance: 200_000 });
    const res = engine.processShareRedemption('LP_BOB', 150_000);

    assert.equal(res.immediateDisbursement, 150_000);
    assert.equal(res.queuedValue, 0);
    assert.equal(res.ticket, null);
    assert.equal(res.idleCashRemaining, 50_000);
    assert.ok(res.guaranteesApplied.includes(REDEMPTION_GUARANTEE_CODES.IDLE_PAR_FULFILLMENT));
  });

  it('issues deterministic FIFO queue ticket when redemption exceeds idle cash', () => {
    const engine = new PooledShareRedemptionEngine({ idleCashBalance: 100_000 });
    const res = engine.processShareRedemption('LP_CHARLIE', 250_000);

    assert.equal(res.immediateDisbursement, 100_000);
    assert.equal(res.queuedValue, 150_000);
    assert.ok(res.ticket !== null);
    assert.equal(res.ticket.ticketId, 'TICKET-1');
    assert.ok(res.ticket.sha256.length === 64);
    assert.equal(res.idleCashRemaining, 0);
  });

  it('fulfills queued tickets in strict chronological order upon debtor repayment', () => {
    const engine = new PooledShareRedemptionEngine({ idleCashBalance: 0 });
    engine.processShareRedemption('LP_1', 50_000);
    engine.processShareRedemption('LP_2', 100_000);

    assert.equal(engine.withdrawalQueue.length, 2);

    // Apply repayment of 60,000: fulfills ticket 1 (50k) and partially ticket 2 (10k)
    const repaymentRes = engine.applyDebtorRepayment(60_000);
    assert.equal(repaymentRes.fulfilledTicketsCount, 1);
    assert.equal(repaymentRes.remainingQueueLength, 1);
    assert.equal(engine.withdrawalQueue[0].queuedValue, 90_000);
  });
});

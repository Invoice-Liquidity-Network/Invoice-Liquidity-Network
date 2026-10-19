import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LiquidityStressSimulator } from '../testing/simulate-stressed-liquidity-redemption.mjs';

describe('Stressed Liquidity Redemption Simulation Suite (#1313)', () => {
  const sim = new LiquidityStressSimulator();

  it('verifies normalized withdrawal model outcomes across all severity levels', () => {
    // 25% severity: 25 requested, 25 paid, 0 queued, 100% fulfillment
    const r25 = sim.simulateWithdrawalWave(25);
    assert.equal(r25.immediatePayout, 25);
    assert.equal(r25.queuedAmount, 0);
    assert.equal(r25.immediateFulfillmentPercent, 100);

    // 50% severity: 50 requested, 40 paid, 10 queued, 80% fulfillment
    const r50 = sim.simulateWithdrawalWave(50);
    assert.equal(r50.immediatePayout, 40);
    assert.equal(r50.queuedAmount, 10);
    assert.equal(r50.immediateFulfillmentPercent, 80);

    // 75% severity: 75 requested, 40 paid, 35 queued, 53.3% fulfillment
    const r75 = sim.simulateWithdrawalWave(75);
    assert.equal(r75.immediatePayout, 40);
    assert.equal(r75.queuedAmount, 35);
    assert.equal(r75.immediateFulfillmentPercent, 53.3);

    // 100% severity: 100 requested, 40 paid, 60 queued, 40% fulfillment
    const r100 = sim.simulateWithdrawalWave(100);
    assert.equal(r100.immediatePayout, 40);
    assert.equal(r100.queuedAmount, 60);
    assert.equal(r100.immediateFulfillmentPercent, 40);
  });

  it('models progressive queue drain via incoming repayment tranches', () => {
    const r50 = sim.simulateWithdrawalWave(50);
    const drain = sim.simulateQueueDrain(r50.queuedAmount, [5, 5]);

    assert.equal(drain.resolved, true);
    assert.equal(drain.remainingQueue, 0);
    assert.equal(drain.roundsToDrain, 2);
  });
});

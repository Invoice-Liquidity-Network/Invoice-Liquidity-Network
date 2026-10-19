import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RedemptionPricingGuard } from '../operations/redemption-pricing-guard.mjs';

describe('Redemption Pricing Deviation Guard Suite (#1310)', () => {
  const guard = new RedemptionPricingGuard();

  it('approves quotes within normal deviation thresholds', () => {
    const res = guard.validateRedemptionQuote({
      requestedUnits: 1000,
      quotedPayout: 990, // 1.0% discount
      navPerUnit: 1.0,
      priceTimestampMs: Date.now() - 5000,
      isStressedMode: false,
    });

    assert.equal(res.approved, true);
    assert.equal(res.deviationPercent, 1.0);
    assert.equal(res.maxAllowedDeviationPercent, 2.0);
  });

  it('rejects quotes with excessive deviation exceeding threshold', () => {
    const res = guard.validateRedemptionQuote({
      requestedUnits: 1000,
      quotedPayout: 970, // 3.0% discount exceeds 2.0% normal cap
      navPerUnit: 1.0,
      priceTimestampMs: Date.now() - 5000,
      isStressedMode: false,
    });

    assert.equal(res.approved, false);
    assert.equal(res.rejectionCode, 'EXCESSIVE_PRICING_DEVIATION');
  });

  it('rejects redemptions backed by stale oracle prices older than 60s', () => {
    const res = guard.validateRedemptionQuote({
      requestedUnits: 1000,
      quotedPayout: 1000,
      navPerUnit: 1.0,
      priceTimestampMs: Date.now() - 65000, // 65s stale
    });

    assert.equal(res.approved, false);
    assert.equal(res.rejectionCode, 'STALE_ORACLE_PRICE');
  });

  it('applies recognized credit impairment to effective NAV preventing arbitrage', () => {
    const res = guard.validateRedemptionQuote({
      requestedUnits: 1000,
      quotedPayout: 960,
      navPerUnit: 1.0,
      priceTimestampMs: Date.now() - 5000,
      pendingImpairmentPercent: 4.0, // 4% recognized default loss
      isStressedMode: true,
    });

    assert.equal(res.approved, true);
    assert.equal(res.effectiveNav, 0.96);
    assert.equal(res.deviationPercent, 0.0);
  });
});

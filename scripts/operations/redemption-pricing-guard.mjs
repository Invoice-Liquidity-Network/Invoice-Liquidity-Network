#!/usr/bin/env node

/**
 * Pricing Deviation Limits & NAV Protection for Redemptions (#1310)
 *
 * Enforces pricing deviation guardrails for LP redemptions and early exits:
 * - Max price deviation limit (capping discounts/haircuts at <= 5.0% vs NAV)
 * - Stale oracle price gating (rejects quotes older than 60 seconds)
 * - Pending default impairment inclusion (prevents front-running runs on pool capital)
 */

import { fileURLToPath } from 'node:url';

export const DEFAULT_REDEMPTION_PRICING_POLICY = {
  maxNormalDeviationPercent: 2.0,
  maxStressedDeviationPercent: 5.0,
  maxPriceAgeSeconds: 60,
};

export class RedemptionPricingGuard {
  constructor(policy = DEFAULT_REDEMPTION_PRICING_POLICY) {
    this.policy = { ...DEFAULT_REDEMPTION_PRICING_POLICY, ...policy };
  }

  validateRedemptionQuote(params) {
    const {
      requestedUnits,
      quotedPayout,
      navPerUnit = 1.0,
      priceTimestampMs,
      currentBlockTimeMs = Date.now(),
      isStressedMode = false,
      pendingImpairmentPercent = 0.0,
    } = params;

    if (!requestedUnits || requestedUnits <= 0) {
      throw new Error('Invalid requested units: must be greater than zero');
    }

    // 1. Stale Oracle Price Check
    const priceAgeSeconds = (currentBlockTimeMs - priceTimestampMs) / 1000;
    if (priceAgeSeconds > this.policy.maxPriceAgeSeconds) {
      return {
        approved: false,
        rejectionCode: 'STALE_ORACLE_PRICE',
        reason: `Oracle pricing is stale (${Math.round(priceAgeSeconds)}s old, max: ${this.policy.maxPriceAgeSeconds}s)`,
        deviationPercent: 0,
      };
    }

    // 2. Adjust NAV for recognized pending loan impairments
    const effectiveNav = navPerUnit * (1.0 - pendingImpairmentPercent / 100);
    const expectedFairPayout = requestedUnits * effectiveNav;
    const actualPricePerUnit = quotedPayout / requestedUnits;
    const deviationPercent = Math.abs((actualPricePerUnit - effectiveNav) / effectiveNav) * 100;

    const maxAllowedDeviation = isStressedMode
      ? this.policy.maxStressedDeviationPercent
      : this.policy.maxNormalDeviationPercent;

    if (deviationPercent > maxAllowedDeviation) {
      return {
        approved: false,
        rejectionCode: 'EXCESSIVE_PRICING_DEVIATION',
        reason: `Quoted redemption deviation ${deviationPercent.toFixed(2)}% exceeds limit of ${maxAllowedDeviation}%`,
        deviationPercent: Math.round(deviationPercent * 100) / 100,
        maxAllowedDeviationPercent: maxAllowedDeviation,
        expectedFairPayout: Math.round(expectedFairPayout * 100) / 100,
      };
    }

    return {
      approved: true,
      deviationPercent: Math.round(deviationPercent * 100) / 100,
      effectiveNav: Math.round(effectiveNav * 10000) / 10000,
      expectedFairPayout: Math.round(expectedFairPayout * 100) / 100,
      actualPayout: quotedPayout,
      maxAllowedDeviationPercent: maxAllowedDeviation,
    };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Testing Redemption Pricing Deviation Guard (#1310)...');
  const guard = new RedemptionPricingGuard();
  const sample = guard.validateRedemptionQuote({
    requestedUnits: 1000,
    quotedPayout: 990, // 1% deviation
    navPerUnit: 1.0,
    priceTimestampMs: Date.now() - 10000,
  });
  console.log('Sample result:', sample);
}

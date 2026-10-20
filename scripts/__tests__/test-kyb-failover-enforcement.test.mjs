import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('KYB Failover without Bypassing Enforcement Suite (#1238)', () => {
  class MockProvider {
    constructor(name, shouldThrow = false, verified = true) {
      this.name = name;
      this.shouldThrow = shouldThrow;
      this.verified = verified;
    }
    async verifyPayer(payer) {
      if (this.shouldThrow) throw new Error(`${this.name} connection timeout`);
      return {
        provider: this.name,
        isVerified: this.verified,
        riskScore: this.verified ? 10 : 90,
      };
    }
  }

  class FailoverProvider {
    constructor(primary, fallback) {
      this.primary = primary;
      this.fallback = fallback;
    }
    async verifyPayer(payer) {
      try {
        const res = await this.primary.verifyPayer(payer);
        return { ...res, failoverAttempted: false };
      } catch (err) {
        const res = await this.fallback.verifyPayer(payer);
        return { ...res, failoverAttempted: true };
      }
    }
  }

  it('uses primary provider when primary is healthy and responsive', async () => {
    const primary = new MockProvider('PrimaryKYB', false, true);
    const fallback = new MockProvider('FallbackKYB', false, true);
    const failover = new FailoverProvider(primary, fallback);

    const res = await failover.verifyPayer('GABC');
    assert.equal(res.provider, 'PrimaryKYB');
    assert.equal(res.isVerified, true);
    assert.equal(res.failoverAttempted, false);
  });

  it('fails over to secondary provider when primary throws, preserving verified verdict', async () => {
    const primary = new MockProvider('PrimaryKYB', true); // throws
    const fallback = new MockProvider('FallbackKYB', false, true);
    const failover = new FailoverProvider(primary, fallback);

    const res = await failover.verifyPayer('GABC');
    assert.equal(res.provider, 'FallbackKYB');
    assert.equal(res.isVerified, true);
    assert.equal(res.failoverAttempted, true);
  });

  it('strictly preserves enforcement and returns isVerified: false when fallback deems entity unverified', async () => {
    const primary = new MockProvider('PrimaryKYB', true); // throws
    const fallback = new MockProvider('FallbackKYB', false, false); // unverified entity!
    const failover = new FailoverProvider(primary, fallback);

    const res = await failover.verifyPayer('GABC');
    assert.equal(res.provider, 'FallbackKYB');
    assert.equal(res.isVerified, false); // ENFORCEMENT PRESERVED!
    assert.equal(res.riskScore, 90);
    assert.equal(res.failoverAttempted, true);
  });

  it('fails closed when both primary and secondary fail', async () => {
    const primary = new MockProvider('PrimaryKYB', true);
    const fallback = new MockProvider('FallbackKYB', true);
    const failover = new FailoverProvider(primary, fallback);

    await assert.rejects(
      async () => await failover.verifyPayer('GABC'),
      /FallbackKYB connection timeout/
    );
  });
});

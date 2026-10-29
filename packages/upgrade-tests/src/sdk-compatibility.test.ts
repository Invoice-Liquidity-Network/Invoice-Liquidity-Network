import { describe, it, expect } from 'vitest';
import { UpgradeTestHarness } from './harness';
import { compareVersions, parseVersion } from '@iln/sdk';

describe('SDK Forward & Backward Compatibility Across Upgrades', () => {
  it('correctly compares semantic versions using SDK utility', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('v2.0.0-beta.1', 'v1.0.0')).toBe(1);

    const parsed = parseVersion('v2.1.3-rc.1');
    expect(parsed.major).toBe(2);
    expect(parsed.minor).toBe(1);
    expect(parsed.patch).toBe(3);
  });

  it('evaluates forward compatibility report for V1 client calling V2 contract', () => {
    const harness = new UpgradeTestHarness({ currentVersion: '2.0.0' });
    const report = harness.evaluateCompatibility('1.0.0', '2.0.0');

    expect(report.isCompatible).toBe(true);
    expect(report.supportedMethods).toContain('submit_invoice');
    expect(report.supportedMethods).toContain('fund_invoice');
    expect(report.supportedMethods).toContain('mark_paid');
    expect(report.supportedMethods).toContain('get_invoice');
    expect(report.schemaDiff.addedFields).toContain('is_auction');
    expect(report.schemaDiff.addedFields).toContain('referral_code');
    expect(report.schemaDiff.removedFields).toHaveLength(0);
  });

  it('evaluates backward compatibility report for V2 client calling V1 contract', () => {
    const harness = new UpgradeTestHarness({ currentVersion: '1.0.0' });
    const report = harness.evaluateCompatibility('2.0.0', '1.0.0');

    expect(report.isCompatible).toBe(true);
    expect(report.supportedMethods).toContain('submit_invoice');
    expect(report.supportedMethods).not.toContain('dispute_invoice');
    expect(report.deprecatedMethods).toHaveLength(0);
  });

  it('verifies that V1 invoice queries against V2 contract return backward-compatible payload', async () => {
    const harness = new UpgradeTestHarness({
      admin: 'GADMIN123',
      currentVersion: '1.0.0',
    });

    const id = harness.submitInvoiceV1({
      id: 501n,
      freelancer: 'GFREELANCER',
      payer: 'GPAYER',
      amount: 100_000n,
      token: 'USDC',
      dueDate: 1735000000,
      discountRate: 300,
    });

    // Upgrade contract to 2.0.0
    await harness.upgradeContract({
      caller: 'GADMIN123',
      newVersion: '2.0.0',
      newWasmHash: 'hash_v2',
    });

    // Client reads through V2 adapter
    const invoice = harness.getInvoiceV2(id);
    expect(invoice).not.toBeNull();
    expect(invoice?.id).toBe(501n);
    expect(invoice?.amount).toBe(100_000n);
    // New optional fields are cleanly defaulted
    expect(invoice?.isAuction).toBe(false);
    expect(invoice?.allowedLps).toBeNull();
    expect(invoice?.referralCode).toBeNull();
  });
});

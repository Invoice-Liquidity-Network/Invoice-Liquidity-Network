import { describe, it, expect } from 'vitest';
import { UpgradeTestHarness } from './harness';

describe('Storage Layout Integrity & Bulk Migration', () => {
  it('prevents key collisions across Instance and Persistent storage namespaces', async () => {
    const harness = new UpgradeTestHarness({
      admin: 'GADMIN123',
      currentVersion: '1.0.0',
    });

    // Write to instance storage
    harness.setInstanceStorage('admin', 'GADMIN123');
    harness.setInstanceStorage('total_volume', 100_000_000n);

    // Write invoice with matching ID/key to persistent storage
    harness.submitInvoiceV1({
      id: 1n,
      freelancer: 'GFREELANCER1',
      payer: 'GPAYER1',
      amount: 50_000_000n,
      token: 'USDC',
      dueDate: 1735000000,
      discountRate: 400,
    });

    await harness.upgradeContract({
      caller: 'GADMIN123',
      newVersion: '2.0.0',
      newWasmHash: 'hash_v2_storage_test',
    });

    expect(harness.getInstanceStorage('admin')).toBe('GADMIN123');
    expect(harness.getInstanceStorage('total_volume')).toBe(100_000_000n);
    expect(harness.getInvoiceV2(1n)?.amount).toBe(50_000_000n);
  });

  it('performs bulk migration of 100+ legacy invoice records without data loss', async () => {
    const harness = new UpgradeTestHarness({
      admin: 'GADMIN123',
      currentVersion: '1.0.0',
    });

    const COUNT = 100;
    for (let i = 1; i <= COUNT; i++) {
      const id = BigInt(i);
      harness.submitInvoiceV1({
        id,
        freelancer: `GFREELANCER_${i}`,
        payer: `GPAYER_${i}`,
        amount: BigInt(i * 10_000),
        token: 'USDC',
        dueDate: 1735000000 + i * 1000,
        discountRate: 200 + (i % 300),
      });

      if (i % 2 === 0) {
        harness.fundInvoiceV1(id, `GLP_${i}`);
      }
    }

    const preUpgradeInvariants = harness.verifyStorageInvariants();
    expect(preUpgradeInvariants.valid).toBe(true);
    expect(preUpgradeInvariants.errors).toHaveLength(0);

    // Execute contract upgrade
    const result = await harness.upgradeContract({
      caller: 'GADMIN123',
      newVersion: '2.0.0',
      newWasmHash: 'hash_v2_bulk',
    });

    expect(result.success).toBe(true);
    expect(result.migratedKeysCount).toBeGreaterThanOrEqual(COUNT);

    const postUpgradeInvariants = harness.verifyStorageInvariants();
    expect(postUpgradeInvariants.valid).toBe(true);
    expect(postUpgradeInvariants.errors).toHaveLength(0);

    // Verify all 100 invoices exist and maintain funded status
    for (let i = 1; i <= COUNT; i++) {
      const inv = harness.getInvoiceV2(BigInt(i));
      expect(inv).not.toBeNull();
      expect(inv?.amount).toBe(BigInt(i * 10_000));
      if (i % 2 === 0) {
        expect(inv?.status).toBe('Funded');
        expect(inv?.funder).toBe(`GLP_${i}`);
      } else {
        expect(inv?.status).toBe('Pending');
      }
    }
  });
});

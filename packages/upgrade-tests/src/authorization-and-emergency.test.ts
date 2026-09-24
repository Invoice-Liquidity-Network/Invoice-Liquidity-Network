import { describe, it, expect } from 'vitest';
import { UpgradeTestHarness, UnauthorizedUpgradeError, ContractPausedError } from './harness';

describe('Authorization Controls & Emergency Pause Preservation', () => {
  it('supports admin key rotation and enforces new admin authority', async () => {
    const harness = new UpgradeTestHarness({
      admin: 'GADMIN_ORIGINAL',
      currentVersion: '1.0.0',
    });

    // Rotate admin key
    harness.setAdmin('GADMIN_NEW_MULTISIG');

    // Previous admin should now be rejected
    await expect(
      harness.upgradeContract({
        caller: 'GADMIN_ORIGINAL',
        newVersion: '2.0.0',
        newWasmHash: 'hash_v2',
      })
    ).rejects.toThrow(UnauthorizedUpgradeError);

    // New admin succeeds
    const result = await harness.upgradeContract({
      caller: 'GADMIN_NEW_MULTISIG',
      newVersion: '2.0.0',
      newWasmHash: 'hash_v2',
    });

    expect(result.success).toBe(true);
    expect(harness.getVersion()).toBe('2.0.0');
  });

  it('preserves emergency pause state across contract upgrade', async () => {
    const harness = new UpgradeTestHarness({
      admin: 'GADMIN_123',
      currentVersion: '1.0.0',
    });

    // 1. Engage circuit breaker
    harness.setPaused(true);
    expect(harness.isPaused()).toBe(true);

    // Submissions should be blocked when paused
    expect(() => {
      harness.submitInvoiceV1({
        id: 101n,
        freelancer: 'GFREELANCER',
        payer: 'GPAYER',
        amount: 100_000n,
        token: 'USDC',
        dueDate: 1735000000,
        discountRate: 300,
      });
    }).toThrow(ContractPausedError);

    // 2. Perform emergency upgrade while paused
    const result = await harness.upgradeContract({
      caller: 'GADMIN_123',
      newVersion: '1.1.0',
      newWasmHash: 'hash_v1_1_patched',
    });

    expect(result.success).toBe(true);

    // 3. Contract MUST remain paused after upgrade
    expect(harness.isPaused()).toBe(true);
    expect(() => {
      harness.submitInvoiceV2({
        id: 102n,
        freelancer: 'GFREELANCER',
        payer: 'GPAYER',
        amount: 100_000n,
        token: 'USDC',
        dueDate: 1735000000,
        discountRate: 300,
      });
    }).toThrow(ContractPausedError);

    // 4. Unpausing restores normal operations
    harness.setPaused(false);
    expect(harness.isPaused()).toBe(false);

    const newId = harness.submitInvoiceV2({
      id: 103n,
      freelancer: 'GFREELANCER',
      payer: 'GPAYER',
      amount: 100_000n,
      token: 'USDC',
      dueDate: 1735000000,
      discountRate: 300,
    });

    expect(newId).toBe(103n);
    expect(harness.getInvoiceV2(103n)?.status).toBe('Pending');
  });
});

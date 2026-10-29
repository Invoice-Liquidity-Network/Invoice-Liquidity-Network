import { describe, it, expect, beforeEach } from 'vitest';
import {
  UpgradeTestHarness,
  UnauthorizedUpgradeError,
  InvalidVersionUpgradeError,
} from './harness';

describe('Contract Upgrade Flow (v1.0.0 -> v2.0.0)', () => {
  let harness: UpgradeTestHarness;
  const adminAddress = 'GADMIN777777777777777777777777777777777777777777777777777777';
  const unauthorizedCaller = 'GEVILUSER11111111111111111111111111111111111111111111111111';

  beforeEach(() => {
    harness = new UpgradeTestHarness({
      admin: adminAddress,
      currentVersion: '1.0.0',
      currentWasmHash: 'wasm_hash_v1_aaaabbbbcccc',
    });
  });

  it('rejects upgrade attempts by non-admin callers', async () => {
    await expect(
      harness.upgradeContract({
        caller: unauthorizedCaller,
        newVersion: '2.0.0',
        newWasmHash: 'wasm_hash_v2_111122223333',
      })
    ).rejects.toThrow(UnauthorizedUpgradeError);

    // Verify version and wasm hash remain untouched
    expect(harness.getVersion()).toBe('1.0.0');
    expect(harness.getWasmHash()).toBe('wasm_hash_v1_aaaabbbbcccc');
  });

  it('rejects upgrade when target version is identical to current version', async () => {
    await expect(
      harness.upgradeContract({
        caller: adminAddress,
        newVersion: '1.0.0',
        newWasmHash: 'wasm_hash_v1_aaaabbbbcccc',
      })
    ).rejects.toThrow(InvalidVersionUpgradeError);
  });

  it('successfully upgrades contract and preserves existing persistent storage', async () => {
    // 1. Seed existing invoices under v1.0.0
    const inv1Id = harness.submitInvoiceV1({
      id: 101n,
      freelancer: 'GFREELANCER1',
      payer: 'GPAYER1',
      amount: 10_000_000n,
      token: 'USDC',
      dueDate: 1735776000,
      discountRate: 500,
    });

    harness.fundInvoiceV1(inv1Id, 'GLP_FUND_1');

    const inv2Id = harness.submitInvoiceV1({
      id: 102n,
      freelancer: 'GFREELANCER2',
      payer: 'GPAYER2',
      amount: 25_000_000n,
      token: 'USDC',
      dueDate: 1736000000,
      discountRate: 400,
    });

    expect(harness.getInvoiceV1(inv1Id)?.status).toBe('Funded');
    expect(harness.getInvoiceV1(inv2Id)?.status).toBe('Pending');

    // 2. Perform in-place WASM upgrade to v2.0.0
    const result = await harness.upgradeContract({
      caller: adminAddress,
      newVersion: '2.0.0',
      newWasmHash: 'wasm_hash_v2_111122223333',
    });

    expect(result.success).toBe(true);
    expect(result.oldVersion).toBe('1.0.0');
    expect(result.newVersion).toBe('2.0.0');
    expect(harness.getVersion()).toBe('2.0.0');
    expect(harness.getWasmHash()).toBe('wasm_hash_v2_111122223333');

    // 3. Verify storage persistence and schema evolution
    const v2Inv1 = harness.getInvoiceV2(inv1Id);
    expect(v2Inv1).not.toBeNull();
    expect(v2Inv1?.id).toBe(101n);
    expect(v2Inv1?.status).toBe('Funded');
    expect(v2Inv1?.funder).toBe('GLP_FUND_1');
    expect(v2Inv1?.amountFunded).toBe(10_000_000n);
    // Sensible defaults for newly added V2 fields
    expect(v2Inv1?.isAuction).toBe(false);
    expect(v2Inv1?.referralCode).toBeNull();
    expect(v2Inv1?.allowedLps).toBeNull();
    expect(v2Inv1?.disputeId).toBeNull();

    // 4. Verify new V2 operations work alongside legacy records
    const inv3Id = harness.submitInvoiceV2({
      id: 103n,
      freelancer: 'GFREELANCER3',
      payer: 'GPAYER3',
      amount: 50_000_000n,
      token: 'USDC',
      dueDate: 1737000000,
      discountRate: 350,
      isAuction: true,
      auctionStartRate: 800,
      auctionMinRate: 350,
      auctionDecayMinutes: 60,
      referralCode: 'REF_PARTNER_01',
    });

    const v2Inv3 = harness.getInvoiceV2(inv3Id);
    expect(v2Inv3?.isAuction).toBe(true);
    expect(v2Inv3?.referralCode).toBe('REF_PARTNER_01');
  });

  it('supports dry-run mode without mutating contract state', async () => {
    const result = await harness.upgradeContract({
      caller: adminAddress,
      newVersion: '2.0.0',
      newWasmHash: 'wasm_hash_v2_test',
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(harness.getVersion()).toBe('1.0.0'); // Unchanged
    expect(harness.getWasmHash()).toBe('wasm_hash_v1_aaaabbbbcccc'); // Unchanged
  });

  it('executes custom migration hooks during upgrade', async () => {
    let migrationExecuted = false;

    const result = await harness.upgradeContract({
      caller: adminAddress,
      newVersion: '2.0.0',
      newWasmHash: 'wasm_hash_v2_with_hook',
      migrationHook: (state) => {
        state.instanceStorage.set('migration_v2_applied', true);
        migrationExecuted = true;
      },
    });

    expect(result.success).toBe(true);
    expect(migrationExecuted).toBe(true);
    expect(harness.getState().instanceStorage.get('migration_v2_applied')).toBe(true);
  });
});

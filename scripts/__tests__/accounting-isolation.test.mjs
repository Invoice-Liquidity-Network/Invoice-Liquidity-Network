import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LedgerAccountingValidator } from '../operations/accounting-isolation-validator.mjs';

describe('First-Loss vs Liquidity Accounting Isolation Suite (#1306)', () => {
  it('disburses redemptions exclusively from liquidity reserve leaving first-loss untouched', () => {
    const validator = new LedgerAccountingValidator();
    const initialFirstLoss = validator.firstLossCapitalBalance;

    const res = validator.processRedemptionDraw(100_000);
    assert.equal(res.success, true);
    assert.equal(res.debitedAccount, 'PoolLiquidityReserveAccount');
    assert.equal(res.firstLossBalance, initialFirstLoss);
  });

  it('rejects redemptions that exceed liquidity reserve without touching first-loss capital', () => {
    const validator = new LedgerAccountingValidator({ liquidityReserve: 50_000, firstLossCapital: 50_000 });

    assert.throws(
      () => validator.processRedemptionDraw(80_000),
      /INSUFFICIENT_LIQUIDITY_RESERVE: Requested 80000/
    );
    assert.equal(validator.firstLossCapitalBalance, 50_000);
  });

  it('absorbs credit defaults exclusively from first-loss provision leaving liquidity reserve untouched', () => {
    const validator = new LedgerAccountingValidator();
    const initialReserve = validator.liquidityReserveBalance;

    const res = validator.absorbCreditDefault(20_000);
    assert.equal(res.success, true);
    assert.equal(res.debitedAccount, 'TreasuryFirstLossAccount');
    assert.equal(validator.liquidityReserveBalance, initialReserve);
    assert.equal(validator.firstLossCapitalBalance, 30_000);
  });
});

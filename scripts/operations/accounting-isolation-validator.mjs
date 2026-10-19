#!/usr/bin/env node

/**
 * First-Loss Capital vs Liquidity Reserve Accounting Validator (#1306)
 *
 * Enforces strict architectural and accounting separation between:
 * 1. Treasury First-Loss Provision Account (dedicated credit-loss absorption tranche)
 * 2. Pool Liquidity Reserve Account (idle unallocated LP capital available for withdrawal)
 *
 * Invariant: First-loss capital CANNOT be used to fulfill LP redemptions;
 * Liquidity reserve CANNOT be drained to absorb borrower credit defaults.
 */

import { fileURLToPath } from 'node:url';

export class LedgerAccountingValidator {
  constructor(initialBalances = {}) {
    this.firstLossCapitalBalance = initialBalances.firstLossCapital ?? 50_000.0; // 5% buffer on $1M pool
    this.liquidityReserveBalance = initialBalances.liquidityReserve ?? 400_000.0; // 40% idle cash on $1M pool
    this.committedPrincipalBalance = initialBalances.committedPrincipal ?? 550_000.0;
    this.ledgerHistory = [];
  }

  processRedemptionDraw(amount) {
    if (amount <= 0) throw new Error('Invalid redemption amount');

    if (amount > this.liquidityReserveBalance) {
      throw new Error(
        `INSUFFICIENT_LIQUIDITY_RESERVE: Requested ${amount}, available in reserve is ${this.liquidityReserveBalance}. First-loss capital cannot be mobilized.`
      );
    }

    this.liquidityReserveBalance -= amount;
    this.ledgerHistory.push({
      action: 'REDEMPTION_DISBURSEMENT',
      debitedAccount: 'PoolLiquidityReserveAccount',
      amount,
      remainingReserve: this.liquidityReserveBalance,
      firstLossUntouched: this.firstLossCapitalBalance,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      debitedAccount: 'PoolLiquidityReserveAccount',
      amount,
      firstLossBalance: this.firstLossCapitalBalance,
      liquidityReserveBalance: this.liquidityReserveBalance,
    };
  }

  absorbCreditDefault(defaultLossAmount) {
    if (defaultLossAmount <= 0) throw new Error('Invalid default amount');

    if (defaultLossAmount > this.firstLossCapitalBalance) {
      const absorbed = this.firstLossCapitalBalance;
      const unabsorbedLoss = defaultLossAmount - absorbed;
      this.firstLossCapitalBalance = 0;

      this.ledgerHistory.push({
        action: 'FIRST_LOSS_EXHAUSTION',
        debitedAccount: 'TreasuryFirstLossAccount',
        absorbed,
        unabsorbedLoss,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        debitedAccount: 'TreasuryFirstLossAccount',
        absorbed,
        unabsorbedLoss,
        firstLossDepleted: true,
      };
    }

    this.firstLossCapitalBalance -= defaultLossAmount;
    this.ledgerHistory.push({
      action: 'CREDIT_DEFAULT_ABSORBED',
      debitedAccount: 'TreasuryFirstLossAccount',
      amount: defaultLossAmount,
      remainingFirstLoss: this.firstLossCapitalBalance,
      liquidityReserveUntouched: this.liquidityReserveBalance,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      debitedAccount: 'TreasuryFirstLossAccount',
      absorbed: defaultLossAmount,
      remainingFirstLoss: this.firstLossCapitalBalance,
      firstLossDepleted: false,
    };
  }

  reconcileTotalLedgerCapital(expectedTotal = 1_000_000.0) {
    const calculatedTotal =
      this.firstLossCapitalBalance + this.liquidityReserveBalance + this.committedPrincipalBalance;
    const balanced = Math.abs(calculatedTotal - expectedTotal) < 0.001;

    return {
      expectedTotal,
      calculatedTotal,
      balanced,
      firstLossCapitalBalance: this.firstLossCapitalBalance,
      liquidityReserveBalance: this.liquidityReserveBalance,
      committedPrincipalBalance: this.committedPrincipalBalance,
    };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Validating First-Loss vs Liquidity Accounting Isolation (#1306)...');
  const validator = new LedgerAccountingValidator();
  console.log('Initial state:', validator.reconcileTotalLedgerCapital());
}

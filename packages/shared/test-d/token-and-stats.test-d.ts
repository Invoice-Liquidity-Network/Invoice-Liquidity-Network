/**
 * Type-level tests for `Token`, `ContractStats`, and `LPStats`.
 *
 * `Token` is a client-side convenience type rather than a contract struct; the
 * two stats types mirror contract return values field-for-field, and both were
 * reshaped when the package was reconciled with the contract. The negative
 * assertions pin the old field names as removed so a stale consumer fails to
 * compile instead of silently reading `undefined`.
 */
import { expectAssignable, expectError, expectType } from 'tsd';
import type { ContractStats, LPStats, Token } from '@iln/shared';

// ─── Token ────────────────────────────────────────────────────────────────────

const token: Token = {
  contractId: 'CUSDC',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 7,
  issuer: 'GISSUER',
  listed: true,
};

expectType<string>(token.contractId);
expectType<string>(token.symbol);
expectType<string>(token.name);
expectType<number>(token.decimals);
expectType<string | null>(token.issuer);
expectType<boolean>(token.listed);

// XLM is the native asset and has no issuing account.
expectAssignable<Token>({ ...token, symbol: 'XLM', name: 'Stellar Lumens', issuer: null });

expectError<Token>({ ...token, issuer: undefined });
expectError<Token>({ ...token, decimals: 7n });
expectError<Token>({ ...token, listed: 'true' });
expectError<Token>({ contractId: 'CUSDC', symbol: 'USDC', name: 'USD Coin', decimals: 7 });

// ─── ContractStats ────────────────────────────────────────────────────────────

const contractStats: ContractStats = {
  totalInvoices: 3n,
  totalFunded: 2n,
  totalPaid: 1n,
  totalVolume: 75_000_000n,
};

expectType<bigint>(contractStats.totalInvoices);
expectType<bigint>(contractStats.totalFunded);
expectType<bigint>(contractStats.totalPaid);
expectType<bigint>(contractStats.totalVolume);

// Every field is a u64/i128 counter, so none of them is a number.
expectError<ContractStats>({ ...contractStats, totalInvoices: 3 });
expectError<ContractStats>({ ...contractStats, totalVolume: 75_000_000 });

// The pre-audit shape carried a derived yield total and default rate; the
// contract returns neither.
expectError<ContractStats>({ ...contractStats, totalYield: 1_250_000n });
expectError<ContractStats>({ ...contractStats, defaultRate: 0.1 });
expectError<ContractStats>({ totalInvoices: 3n, totalVolume: 75_000_000n });

// ─── LPStats ──────────────────────────────────────────────────────────────────

const lpStats: LPStats = {
  totalFunded: 50_000_000n,
  totalEarned: 1_000_000n,
  activePositions: 2n,
  totalPositions: 9n,
  avgYieldBps: 275,
};

expectType<bigint>(lpStats.totalFunded);
expectType<bigint>(lpStats.totalEarned);
expectType<bigint>(lpStats.activePositions);
expectType<bigint>(lpStats.totalPositions);
expectType<number>(lpStats.avgYieldBps);

// avgYieldBps is a u32 basis-point figure, not a fractional rate held as bigint.
expectError<LPStats>({ ...lpStats, avgYieldBps: 275n });
expectError<LPStats>({ ...lpStats, activePositions: 2 });

// The pre-audit shape was { deployed, yield, invoiceCount, defaultRate }.
expectError<LPStats>({ ...lpStats, deployed: 50_000_000n });
expectError<LPStats>({ ...lpStats, invoiceCount: 2 });
expectError<LPStats>({ ...lpStats, defaultRate: 0.05 });
expectError<LPStats>({ totalFunded: 50_000_000n, totalEarned: 1_000_000n });

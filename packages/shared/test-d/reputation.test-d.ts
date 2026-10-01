/**
 * Type-level tests for `ReputationScore`.
 *
 * The lifetime counters are u64 on-chain and therefore `bigint`, while the score
 * itself is u32 and therefore `number`. Consumers that treat the counters as
 * numbers compile fine against literals but overflow silently against real
 * indexer data, so the split is asserted invariantly.
 */
import { expectAssignable, expectError, expectType } from 'tsd';
import type { ReputationScore } from '@iln/shared';

const reputation: ReputationScore = {
  address: 'GADDRESS',
  score: 87,
  invoicesSubmitted: 12n,
  invoicesPaid: 11n,
  invoicesDefaulted: 1n,
  lastActivityLedger: 5_500_000n,
};

expectType<string>(reputation.address);
expectType<number>(reputation.score);
expectType<bigint>(reputation.invoicesSubmitted);
expectType<bigint>(reputation.invoicesPaid);
expectType<bigint>(reputation.invoicesDefaulted);
expectType<bigint>(reputation.lastActivityLedger);

// Scores can exceed 100 for highly reliable accounts, and start at zero.
expectAssignable<ReputationScore>({ ...reputation, score: 0 });
expectAssignable<ReputationScore>({ ...reputation, score: 140 });

// ─── Invalid usage ────────────────────────────────────────────────────────────

// The pre-audit shape was { address, score, updatedAt } — every counter and the
// activity ledger are required now.
expectError<ReputationScore>({ address: 'GADDRESS', score: 87, updatedAt: 1_700_000_000 });
expectError<ReputationScore>({ address: 'GADDRESS', score: 87 });

// u64 counters are bigint, not number.
expectError<ReputationScore>({ ...reputation, invoicesSubmitted: 12 });
expectError<ReputationScore>({ ...reputation, invoicesPaid: 11 });
expectError<ReputationScore>({ ...reputation, invoicesDefaulted: 1 });
expectError<ReputationScore>({ ...reputation, lastActivityLedger: 5_500_000 });

// The u32 score is a number, not a bigint.
expectError<ReputationScore>({ ...reputation, score: 87n });

// There is no freshness timestamp — freshness is derived from lastActivityLedger.
expectError<ReputationScore>({ ...reputation, updatedAt: 1_700_000_000 });

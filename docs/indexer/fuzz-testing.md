# Indexer Fuzz Testing

The indexer's event-processing layer (`indexer/src/processor.ts`) is covered by
property-based fuzzing with [fast-check](https://fast-check.dev) in addition to
the example-based tests in `indexer/tests/ingestion.test.ts`. The fuzzer
generates event shapes the RPC never should, but a compromised node, a contract
upgrade or a stellar-sdk change could: missing fields, wrong types, XDR values of
the wrong kind, out-of-range numbers, and invoice states that do not match the
schema.

## Invariants

Every property lives in `indexer/tests/processor.fuzz.test.ts` and must hold for
any generated input:

| Property | Statement |
|---|---|
| `decodeEvent` is total | Decoding never throws; every input is `ok`, `ignored` or `malformed`. |
| no-crash | `processEvent` never rejects for any event shape while the database is healthy. An RPC exception is the one allowed rejection and must leave no partial state. |
| single-outcome | Each input produces exactly one of: an `events` row (processed), nothing (ignored), or one `dead_letter_events` row (malformed input or malformed invoice state). |
| integrity | An `events` row always carries the decoded id, a safe non-negative integer invoice id, the original ledger and type; a stored invoice always passes `isValidInvoiceState`. |
| idempotent | Replaying a valid event leaves the database unchanged. |
| order-independent | For any interleaving of valid events for one invoice, the last fetched state wins. |
| payload serialisation is total | Dead-letter payloads always serialise to valid JSON, including XDR, bigints, cycles and oversized inputs. |

Malformed input is routed to the dead-letter table (`indexer/src/deadLetter.ts`,
metric `iln_events_dead_lettered_total{reason}`) instead of crashing the poller
or being silently dropped. The dead-letter queue replay tooling from the
hardening batch builds on the same table.

## Findings fixed by this suite

The first campaign (1,500 runs against the previous processor) found seven
crash or corruption classes. Each is preserved as a corpus case in
`indexer/tests/fuzz-corpus/` with the original finding in its `finding` field:

- a `null`, string or non-XDR topic entry threw `TypeError` from `scValToNative`
- a missing `value` threw `TypeError`
- string, vector, negative i128 and above-2^53 u64 values produced `NaN`,
  negative or precision-lossy invoice ids that were persisted
- numeric ids, empty ids, float or missing ledgers and numeric `ledgerClosedAt`
  raised SQLite `datatype mismatch` after decoding succeeded
- an invoice state from the RPC with missing fields threw from the named
  parameter binding after the event row was already written, so the event was
  deduplicated forever with no invoice behind it
- an RPC exception likewise left the event row behind

The fixes: `indexer/src/decode.ts` validates every field before anything is
written, `isValidInvoiceState` guards the RPC result, and the event row and
invoice upsert are written in one SQLite transaction after the fetch.

## Running

```bash
cd indexer
pnpm exec vitest run tests/processor.fuzz.test.ts            # default budget: 300 runs per property
FUZZ_RUNS=5000 pnpm exec vitest run tests/processor.fuzz.test.ts
FUZZ_SEED=1234 pnpm exec vitest run tests/processor.fuzz.test.ts # reproduce a run
pnpm exec vitest run tests/processor.corpus.test.ts          # replay persisted counterexamples only
```

CI runs both files on every pull request touching `indexer/` with 300 runs per
property, and nightly with 5,000 (`.github/workflows/indexer-fuzz.yml`,
25-minute budget). The workflow uploads the corpus directory as an artifact and
opens an issue when a nightly run fails.

## When the fuzzer finds something

1. The failing property persists its counterexample as
   `indexer/tests/fuzz-corpus/fuzz-<property>-<hash>.json` with `finding`
   starting in `UNREVIEWED`. The corpus replay test fails on such a file on
   purpose.
2. Reproduce with the seed printed by fast-check, or just replay the corpus.
3. Fix the code, then edit the case: describe the finding, set
   `expect.outcome` (`processed`, `ignored`, `malformed` with `reason`, or
   `throws`) and remove the `UNREVIEWED` prefix.
4. Commit the case with the fix. It is replayed on every run from then on.

## Adding generators

Generators live in `indexer/tests/fuzz/arbitraries.ts`. Keep valid shapes at a
high weight so the idempotency and integrity properties are exercised on real
events, and add new malformed variants next to the field they corrupt. Use the
`ABSENT` sentinel for "property missing"; `materialize` turns it into a
genuinely absent key. Corpus files use `{ "$xdr": base64 }` for XDR values,
`{ "$bigint": "..." }`, `{ "$absent": true }` and `{ "$nan": true }` so every
generated shape round-trips through JSON.

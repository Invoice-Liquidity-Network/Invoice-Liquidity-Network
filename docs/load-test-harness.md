# Load Test Harness — Issue #792

## Overview

The three load-test scripts (`scripts/load-test.ts`, `scripts/load-test-indexer.ts`,
`scripts/load-test-notifications.ts`) now share a common harness module at
`scripts/lib/load-test-harness.ts`. The thin wrappers delegate to the shared
`runLoadTest()` function instead of duplicating the worker pool, metrics, and
report-generation logic.

## What changed

| File | Before | After |
|---|---|---|
| `scripts/load-test.ts` | Monolithic ~600-line script with inline workers/reporting | Thin CLI entrypoint importing `runLoadTest`, `printReport`, `writeMarkdownReport`, `writeJsonReport` from the harness |
| `scripts/load-test-indexer.ts` | `spawnSync` wrapper around `load-test.ts` | Direct import of harness with `--service indexer` default |
| `scripts/load-test-notifications.ts` | `spawnSync` wrapper around `load-test.ts` | Direct import of harness with `--service notifications` default |
| `scripts/lib/load-test-harness.ts` | *did not exist* | New shared module exporting types, helpers, `runLoadTest()`, and report writers |

## Benefits

- **Single source of truth** for percentile math, threshold checking, and report formatting.
- **Bug fixes propagate** automatically to all three scripts.
- **Easier testing**: the core `runLoadTest()` function can be unit-tested in isolation.
- **Equivalent output**: the Markdown/JSON reports produced by the refactored scripts are byte-for-byte compatible with the previous implementation.

## Usage stays the same

```bash
# Full suite
npx ts-node --esm scripts/load-test.ts --duration 30

# Service-specific wrappers still work
npx ts-node --esm scripts/load-test-indexer.ts --duration 30
npx ts-node --esm scripts/load-test-notifications.ts --duration 30
## Oracle-service scenario — Issue #1056

The harness now supports `--service oracle` (plus a `scripts/load-test-oracle.ts`
wrapper and a `test:load:oracle` npm script) that models realistic mainnet
oracle update frequency:

- **75 verify requests/minute across 15 payer source accounts** by default
  (`oracleServiceScenario(baseUrl, sourceCount = 15, requestsPerMinute = 75)`),
  matching the projected mainnet mix of distinct payers × invoices.
- Each request is a `POST /v1/verify` (or legacy `POST /verify`) with a random
  payer, amount, and invoice id, plus `GET /health` / `GET /v1/health` probes.
- `--oracle-url` (default `http://localhost:3010`) selects the target.

### Staleness-threshold checks

`checkOracleStalenessThresholds(report, thresholds)` feeds the run results into
capacity planning:

- `minThroughputRps` (default 0.5): flags runs whose measured RPS falls below
  the rate needed to keep oracle data fresh.
- `verificationLatencySloMs` (default 3000): flags runs whose average verify
  latency exceeds the verification SLO.
- `maxStaleAgeMs` (default 300000 = `ORACLE_MAX_ORACLE_AGE_MS`): documented
  alongside the report so staleness-threshold decisions cite measured data.

### Throughput ceiling & failure mode

When the offered load exceeds oracle capacity, the expected failure mode is
**backpressure, not drops or crashes**: the per-IP rate-limiting middleware
answers excess traffic with HTTP 429 (`Rate limit exceeded`), which the harness
records as failed requests with elevated p95. A ceiling run therefore shows up
as rising 429 counts and p95 growth while the process stays alive — the report's
`=== ORACLE METRICS ===` section (total verify requests, avg verify latency)
makes this visible.

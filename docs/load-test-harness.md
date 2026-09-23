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
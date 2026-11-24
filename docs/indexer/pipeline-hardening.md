# Indexer Pipeline Hardening: Verified Behaviour

This page records the verified behaviour, failure semantics, residual risk, and maintainer decisions for four core indexer pipeline subsystems:

| Issue | Subsystem & File | Target Tests |
| --- | --- | --- |
| #1436 | RPC Polling Cursor Advancement (`indexer/src/poller.ts`) | `tests/poller.test.ts` |
| #1437 | Transaction Batch Atomicity (`indexer/src/processor.ts`) | `tests/ingestion.test.ts` |
| #1438 | Database Migration Rollback & Versioning (`indexer/src/db.ts`) | `tests/migrations.test.ts` |
| #1439 | Reconciliation Failure Semantics (`indexer/src/reconciliation.ts`) | `tests/reconciliation.test.ts` |

---

## 1. RPC Polling Cursor Advancement (#1436)

**Source of truth:** The `cursor` table in SQLite (`last_ledger` column), read via `getCursorLedger()` and updated via `setCursorLedger()`.

### Problem Statement
A failed or partial poll must never advance the persisted cursor before all data in the polling cycle has been successfully fetched and persisted. In the previous implementation, cursor advancement occurred per-page inside the pagination loop; if a subsequent page failed (network timeout, RPC error, or process crash), the cursor had already advanced past events on earlier pages or split ledgers without completing the full cycle.

### Verified Behaviour Matrix

| Case | Result |
| --- | --- |
| **Normal (Single/Multi-page)** | All pages are retrieved, confirmed events processed into SQLite, and cursor advances exactly once at cycle completion to `max(highestEventLedger, confirmedTip)`. |
| **Failed (Mid-cycle / Page 2 failure)** | Throws RPC/fetch error; persisted cursor in SQLite remains at the pre-cycle value (or last fully committed cycle). No partial advancement occurs. |
| **Repeated / Replay** | Poller re-executes from the stored cursor ledger. Deduplication (`hasEvent`) skips already persisted events idempotently without double-counting. |
| **Stale / Reorg** | When chain tip falls below cursor, poller detects `latestKnownLedger < stored`, rolls back to bounded ledger, and resets cycle boundaries cleanly. |
| **Interrupted (Process crash)** | On restart, poller resumes from the persisted SQLite cursor. Events from partially completed cycles are safely re-queried and deduplicated. |

### Residual Risk & Maintainer Decisions
- **Re-scan Overlap**: Resuming from the stored cursor re-evaluates events in the boundary ledger. This is intentional to prevent missed events at ledger boundaries. `applyEventWithInvoice` handles deduplication idempotently.

---

## 2. Transaction Batch Atomicity (#1437)

**Source of truth:** SQLite transactions wrapped in `applyEventWithInvoice` (`indexer/src/db.ts`) executing atomically across `events` and `invoices` tables.

### Problem Statement
Processing Soroban events involves decoding topic/value fields, fetching on-chain state via RPC, and persisting records. Unverified atomicity could allow an event record to commit without its corresponding invoice state (or vice versa) during crash recovery, decode errors, or duplicate event delivery.

### Verified Behaviour Matrix

| Case | Result |
| --- | --- |
| **Normal Success** | `applyEventWithInvoice` atomically commits the event row and upserts the invoice state within a single SQLite transaction. |
| **Failed Write / Constraint Violation** | If invoice upsert fails (e.g. NOT NULL violation or corrupt data), the entire transaction rolls back; neither event nor invoice survives. |
| **Partial Decode / Unsupported Type** | Events with unrecognized topics or malformed payloads short-circuit before any database write, preserving DB integrity. |
| **Duplicate Event Delivery** | Deduplication check (`hasEvent`) short-circuits processing immediately. If concurrent duplicate execution occurs, primary key constraint (`event_id`) prevents duplicates. |
| **Crash & Recovery** | Any uncommitted transaction is rolled back by SQLite WAL journal on restart. Subsequent replay cleanly re-fetches and applies state without orphaned records. |

### Residual Risk & Maintainer Decisions
- **RPC Retry Backoff**: `fetchInvoice` retries up to 3 times with exponential backoff before throwing. If RPC remains unreachable, the event is deferred to the next polling cycle.

---

## 3. Database Migration Rollback & Versioning (#1438)

**Source of truth:** `schema_migrations` table in SQLite (`version`, `applied_at`, `description`), verified via `getSchemaVersion(db)` and `applySchemaVersion(db, ...)`.

### Problem Statement
Incompatible, partially applied, or out-of-order schema migrations could leave the indexer in a corrupted or half-migrated state, causing silent runtime failures or data inconsistency.

### Verified Behaviour Matrix

| Case | Result |
| --- | --- |
| **Normal Initial Migration** | `createDb` runs schema creation and atomically records `SCHEMA_VERSION = 1` in `schema_migrations`. |
| **Repeated Migration (Idempotency)** | Re-running migrations on an already up-to-date database detects existing version and safely no-ops without error or duplicate records. |
| **Failed Migration (Rollback)** | If DDL or migration logic fails mid-execution, transactional DDL rolls back changes; version record is not inserted, leaving schema clean. |
| **Stale / Rollback Attempt** | Attempting to apply a schema version lower than the recorded maximum throws an invariant violation error, refusing to trust corrupt state. |
| **Interrupted / Gap (Version Skip)** | Attempting to apply a version that skips sequence numbers (e.g., version 3 when max is 1) throws an error, enforcing strict sequential upgrades. |

### Residual Risk & Maintainer Decisions
- **Production Migrations**: SQLite schema changes must declare an online strategy and respect lock/runtime budgets verified by `migrationHarness`. Downgrades require tested explicit `down()` definitions.

---

## 4. Reconciliation Failure Semantics (#1439)

**Source of truth:** Live Soroban RPC chain tip (`server.getLatestLedger()`) compared against indexer SQLite cursor (`getCursorLedger()`), evaluated against canonical confirmation depth policy (`confirmationPolicy.getDepth()`).

### Problem Statement
Reconciliation jobs that encounter errors or detect uncorrected drift must not report healthy status. In previous code, RPC errors were swallowed and drift was not exposed in operational health models.

### Verified Behaviour Matrix

| Case | Result |
| --- | --- |
| **Normal Aligned** | Cursor is within confirmation depth of chain tip (`driftLedgers <= depth`): returns `{ healthy: true, driftLedgers, recommendation }`. |
| **Unhealthy Drift** | Cursor lags chain tip beyond confirmation depth (`driftLedgers > depth`): returns `{ healthy: false }` with actionable drift recommendation. |
| **Chain Reorg (Negative Drift)** | Chain tip is below persisted cursor (`driftLedgers < 0`): returns `{ healthy: false }` alerting to an active reorg requiring poll reconciliation. |
| **RPC Unreachable / Node Down** | RPC call rejects: returns `{ healthy: false, chainTipLedger: null }` reporting node unreachability without masking failure. |
| **Repeated Execution** | `runReconciliation()` is idempotent and safe for periodic execution; failures in scheduled runs log warnings and never crash the process. |

### Residual Risk & Maintainer Decisions
- **Scheduler Interval**: Defaults to 1 hour (`3600000ms`). Production environments under high ledger throughput can tune the interval via configuration.

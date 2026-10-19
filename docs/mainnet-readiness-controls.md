# Mainnet Readiness Controls Specification (#1289)

This document provides a comprehensive operational breakdown of all production controls, enforcement mechanisms, reproducible verification commands, and physical audit artifacts required for the Invoice Liquidity Network mainnet release.

---

## 1. Security Controls

### SEC-01: External Security Audit Evidence
- **Objective**: Ensure independent third-party verification of all Soroban smart contracts, signing paths, and RPC indexer integrations with zero unresolved Critical or High findings.
- **Enforcing Script**: `scripts/operations/verify-audit-evidence.mjs`
- **Verification Command**: `pnpm verify:audit-evidence`
- **Audited Artifact**: `.artifacts/audits/audit-evidence-manifest.json`
- **Owner**: Security Lead (`@security-lead`)
- **Recovery Path**: Remediate findings, tag patch release, and re-run audit verification.

### SEC-02: Test Coverage Thresholds
- **Objective**: Maintain strict test coverage thresholds across SDK, CLI, contracts, and indexer before release freeze.
- **Enforcing Script**: `scripts/check-e2e-coverage.mjs`
- **Verification Command**: `pnpm test:coverage`
- **Audited Artifact**: `coverage/lcov.info`
- **Owner**: QA Lead (`@qa-lead`)

---

## 2. Smart Contract Controls

### CTR-01: Circuit Breaker & Emergency Pause
- **Objective**: Prove emergency pause and recovery failover paths for invoice funding, settlement, and liquidity withdrawals.
- **Enforcing Script**: `scripts/drills/exercise-oracle-rollback-recovery.mjs`
- **Verification Command**: `pnpm drill:oracle-rollback`
- **Audited Artifact**: `.artifacts/drills/drill-oracle-rollback-recovery.json`
- **Owner**: Security Lead (`@security-lead`)

### CTR-02: Multi-Sig Governance Administration
- **Objective**: Enforce quorum, timelock, and multi-signature authorization on all administrative contract upgrades.
- **Enforcing Script**: `scripts/operations/verify-independent-signoff-workflow.mjs`
- **Verification Command**: `pnpm verify:independent-signoff`
- **Audited Artifact**: `.artifacts/launch/reproducible-verification-artifacts.json`
- **Owner**: Governance Lead (`@governance-lead`)

---

## 3. Infrastructure Controls

### INF-01: Indexer Operations & Ledger Lag Budget
- **Objective**: Maintain continuous ledger synchronization with lag strictly bounded below 10 ledgers.
- **Enforcing Script**: `scripts/operations/verify-indexer-operations.mjs`
- **Verification Command**: `pnpm verify:indexer-ops`
- **Audited Artifact**: `.artifacts/indexer/indexer-operations-audit.json`
- **Owner**: Infrastructure Lead (`@infra-lead`)

### INF-02: Backup Archive & Replay Integrity
- **Objective**: Verify reproducible restore from SQLite database snapshots and backup tarballs within recovery time objectives.
- **Enforcing Script**: `scripts/drills/exercise-indexer-rollback-unpaused.mjs`
- **Verification Command**: `pnpm drill:indexer-rollback`
- **Audited Artifact**: `.artifacts/drills/drill-indexer-rollback-unpaused.json`
- **Owner**: Infrastructure Lead (`@infra-lead`)

---

## 4. Documentation & Release Controls

### DOC-01: Offline Docs Link Checker Gate
- **Objective**: Guarantee zero broken internal links or stale routes across all documentation files during CI.
- **Enforcing Script**: `scripts/check-doc-links.mjs --offline`
- **Verification Command**: `pnpm check:doc-links:offline`
- **Audited Artifact**: `docs/runbooks/docs-link-checker-ci.md`
- **Owner**: Docs Lead (`@docs-lead`)

### REL-01: Launch Readiness Exception & Waiver Quorum
- **Objective**: Strictly prohibit waivers on existential invariants; enforce 3-lead unanimous sign-off on minor exceptions.
- **Enforcing Script**: `scripts/operations/launch-readiness-exception-evaluator.mjs`
- **Verification Command**: `pnpm verify:launch-exception`
- **Audited Artifact**: `docs/runbooks/launch-readiness-exception-process.md`
- **Owner**: Release Lead (`@release-lead`)

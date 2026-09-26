# Flaky Test Detection and Quarantine — Issue #805

## Overview

This document defines the flaky-test detection mechanism and formal quarantine
process for the Invoice Liquidity Network CI matrix. It covers automated detection,
quarantine history tracking, and re-quarantine enforcement to prevent regression
of previously-fixed flaky tests.

## Detection

CI re-runs any failed test suite once automatically. If the re-run passes,
the original failure is flagged as flaky rather than treated as a hard failure.
The PR comment includes:

```
⚠️ Flaky test detected: <test name> failed once, then passed on re-run.
Quarantine this test if it is a known issue.
```

## Quarantine Convention

A quarantined test is annotated with `@flaky` in the test source:

```typescript
test.only("occasionally fails under load", () => {
  // ...
});
// Mark as:
// @flaky known-flaky: timing-dependent notification delivery (issue: #1234)
```

Or in Vitest:

```typescript
test("flaky: occasionally fails under load", () => {
  // ...
});
```

**Requirements for quarantined tests:**

1. **Tracking issue:** Every quarantined test must have a corresponding issue
   tracking the root-cause fix. Reference the issue number in the `@flaky` annotation.
2. **TTL:** Quarantine is indefinite but must be reviewed quarterly. Add a
   `flaky-until` label with a date.
3. **Visibility:** CI reports the count of quarantined tests in the PR summary.
4. **History:** Quarantine history is tracked in `.quarantine-history.json` to detect
   repeated failures and enable automatic re-quarantine.

## Un-quarantine and Re-Quarantine

### Initial Un-quarantine

When the root cause is fixed:

1. Remove the `@flaky` annotation.
2. Close the tracking issue.
3. Remove the `flaky-until` label.
4. The test is now monitored for repeat flakiness during the first N CI runs.

### Automatic Re-Quarantine on Repeat Flake

If a test flakes again within N runs of being un-quarantined (see Monitoring below):

1. CI automatically detects the repeat flakiness.
2. The script `scripts/manage-quarantine.mjs` automatically re-quarantines the test:
   - Adds the `@flaky` annotation back
   - Increments the quarantine attempt counter in `.quarantine-history.json`
   - Opens or updates the tracking issue with a comment noting the repeat failure
3. A maintainer review is still required before the next un-quarantine attempt.

## Process

| Step | Action |
|---|---|
| Detect | CI re-run flags flaky result |
| Triage | Maintainer adds `@flaky` annotation and opens tracking issue |
| Fix | Issue assigned, root cause addressed |
| Un-quarantine | Remove `@flaky` annotation and enter monitoring window |
| Monitor | Test runs at least N times in CI (see below) |
| Repeat flake (if detected) | CI automatically re-quarantines via `manage-quarantine.mjs` |
| Verify (no repeat) | Test passes consistently; quarantine annotation remains removed |
| Clear | Annotation removed (if already removed), issue closed |

## Monitoring and Automatic Re-Quarantine

### Quarantine History Tracking

Quarantine history is stored in `.quarantine-history.json` at the repository root:

```json
{
  "tests/e2e/lifecycle.test.ts": {
    "name": "should handle full invoice lifecycle",
    "quarantine_count": 2,
    "first_quarantined": "2025-01-15T10:30:00Z",
    "last_un_quarantined": "2025-09-20T14:00:00Z",
    "last_quarantine_reason": "flaked 2 times within 10 CI runs of un-quarantine",
    "issue": "#1234"
  }
}
```

### Re-Quarantine Thresholds

- **Monitoring window:** A test is monitored for N=10 consecutive CI runs after un-quarantine
- **Re-quarantine trigger:** If the test flakes 2+ times during the monitoring window, it is automatically re-quarantined
- **Report:** CI workflow generates a quarantine-change report in the build summary

### Quarantine Report

The workflow `scripts/report-quarantine-age.mjs` generates a quarterly report:

```
Quarantine Age and Churn Report
================================
Tests in long-term quarantine (>90 days):
- tests/e2e/lifecycle.test.ts (#1234): 187 days, 2 re-quarantine attempts
- tests/notifications/delivery.test.ts (#1240): 120 days, 0 re-quarantine attempts

Tests with high re-quarantine churn (3+ attempts):
- tests/indexer/reorg-handling.test.ts (#1250): 4 re-quarantine attempts, last: 2025-09-20
```

This report is generated on a quarterly schedule and shared with the team.

## Process

## References

- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [CI/CD Pipeline](./ci-cd.md)
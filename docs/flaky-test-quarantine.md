# Flaky Test Detection and Quarantine — Issue #805

## Overview

This document defines the flaky-test detection mechanism and formal quarantine
process for the Invoice Liquidity Network CI matrix.

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
// @flaky known-flaky: timing-dependent notification delivery
```

Or in Vitest:

```typescript
test("flaky: occasionally fails under load", () => {
  // ...
});
```

**Requirements for quarantined tests:**

1. **Tracking issue:** Every quarantined test must have a corresponding issue
   tracking the root-cause fix.
2. **TTL:** Quarantine is indefinite but must be reviewed quarterly. Add a
   `flaky-until` label with a date.
3. **Visibility:** CI reports the count of quarantined tests in the PR summary.

## Un-quarantine

When the root cause is fixed:

1. Remove the `@flaky` annotation.
2. Close the tracking issue.
3. Remove the `flaky-until` label.

## Process

| Step | Action |
|---|---|
| Detect | CI re-run flags flaky result |
| Triage | Maintainer adds `@flaky` annotation and opens tracking issue |
| Fix | Issue assigned, root cause addressed |
| Verify | Test passes consistently for 5 runs |
| Clear | Annotation removed, issue closed |

## References

- [CONTRIBUTING.md](../CONTRIBUTING.md)
# Per-Workspace Test Runtime Budgets — Issue #808

## Overview

Individual test suites can grow slow over time without anyone noticing until
CI feels sluggish. This document defines the runtime budget system that makes
regressions visible immediately and attributable to the change that caused them.

## Initial Budgets (Example)

| Workspace | Budget (seconds) | Basis |
|---|---|---|
| sdk/ | 60 | Current measured runtime |
| cli/ | 45 | Current measured runtime |
| indexer/ | 60 | Current measured runtime |
| notifications/ | 30 | Current measured runtime |
| packages/* | 30 | Current measured runtime |

Budgets are set with headroom above current measured runtimes. They are updated
via PR when legitimate increases are expected.

## CI Enforcement

Each CI test job measures its own runtime and compares it against the budget.
If a suite exceeds its budget:

- CI posts a **warning annotation** on the PR (not a hard failure).
- The PR comment includes:
  - Measured runtime vs budget
  - Which tests took the longest
  - Guidance on how to update the budget if the increase is legitimate

## Updating a Budget

1. Measure the new runtime on `main`.
2. Open a PR with the new budget in this document.
3. Once merged, update the CI comparison threshold.

## References

- [CONTRIBUTING.md](../CONTRIBUTING.md)
# Secrets Baseline Audit — Issue #793

**Date:** 2026-07-27  
**Auditor:** Automated baseline regeneration + manual review  
**Baseline file:** `.secrets.baseline`

## Summary

The `.secrets.baseline` file exists, is tracked in git, and is currently an
empty array (`[]`). A fresh regeneration via the `gitleaks:baseline` script
produces identical output, confirming the baseline is current and there are no
known false positives in the repository.

## Verification Steps

1. Confirmed file exists at `.secrets.baseline`
2. Reviewed baseline contents: `[]` (empty)
3. Confirmed file is NOT gitignored
4. Config verified: `gitleaks.toml` allowlists `.secrets.baseline` itself

## Allowed Exceptions

None. The baseline contains no entries, meaning gitleaks reports zero
suppressed findings. Every match would be treated as a new finding.

## Findings

No action required. The baseline is current and accurate.

## Ongoing enforcement

The tracked baseline is enforced continuously, not only by this dated audit:

- Every pull request and push runs `pnpm gitleaks:scan` in the required CI workflow.
  The command exits non-zero for any finding not already represented in the baseline.
- A scheduled workflow runs on the first day of January, April, July, and October,
  and compares a freshly generated report with the tracked baseline. It can also be
  started manually with `workflow_dispatch`.
- Baseline changes must be reviewed as security-sensitive changes; they are not an
  automatic way to suppress findings.

## Maintenance

Regenerate this baseline after any legitimate secret-shaped strings are added
to the repo (e.g., test fixtures with realistic-looking tokens):

```bash
pnpm gitleaks:baseline
```

Then review every new entry before committing to ensure it is a genuine false
positive.
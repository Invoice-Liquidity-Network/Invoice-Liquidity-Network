# Mainnet Checklist Evidence Automation Runbook (#1299)

This specification governs automated verification of non-issue evidence links (documentation, workflows, test directories) referenced in `docs/mainnet-launch-checklist.md`.

## Verification Scope

1. **Local Documents**: Verifies all relative `.md` links exist, are readable, and non-empty.
2. **CI/CD Workflows**: Confirms referenced GitHub Actions workflows exist under `.github/workflows/`.
3. **Test Suites**: Asserts that referenced test packages and SDK verification files are present.

## Verification

```bash
pnpm test:checklist-evidence
```

# Docs Link Checker CI Gate Runbook (#1292)

This operational specification governs the automated detection of broken internal and external documentation links in CI.

## 1. CI Integration Invariants

- **PR Gating (Offline Gate)**: Pull requests execute `node scripts/check-doc-links.mjs --offline` in `.github/workflows/ci.yml` to block merges with broken internal links without relying on external network dependencies.
- **Scheduled Link Rot Detection**: The dedicated `.github/workflows/docs-link-check.yml` runs on a weekly schedule to catch external URL rot.

## 2. Verification

```bash
pnpm test:doc-links
```

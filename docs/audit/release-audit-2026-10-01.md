# Release Audit — 2026-10-01

Summary
- Performed an automated audit of package `package.json` versions and nearby `CHANGELOG.md` files.

Findings
- Several packages under `packages/` and top-level `sdk/` and `cli/` do not have a `CHANGELOG.md` next to their `package.json`. This repository uses a mix of centralized and per-package changelogs; missing per-package changelogs risk missed or stale entries during automated releases.

Immediate fixes applied
- Added `scripts/audit-package-releases.mjs` to enumerate package.json files and verify changelog mentions.
- Enhanced `scripts/verify-release-dry-run.mjs` to fail releases when a computed version lacks changelog entries in package-level changelogs.

Recommended next steps
- Decide on authoritative changelog strategy: per-package vs centralized aggregated changelog.
- For per-package model: add `CHANGELOG.md` to each publishable package and enforce via CI check (already hinted by `scripts/audit-package-releases.mjs`).
- For centralized model: update `scripts/verify-release-dry-run.mjs` to check the central changelog location.

Documentation
- See `scripts/audit-package-releases.mjs` and `scripts/verify-release-dry-run.mjs` for verification logic.

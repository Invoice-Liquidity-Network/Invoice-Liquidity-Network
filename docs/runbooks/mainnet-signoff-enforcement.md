# Mainnet Launch Sign-Off Gate Specification (#1301)

This gate prevents premature sign-off on mainnet readiness before all migration and security milestones are satisfied.

## Invariant Enforcement

1. **Fail-Closed Sign-off**: If `- [x] **Final Org-Level Sign-off**` is checked in `docs/mainnet-launch-checklist.md`, every row in the checklist tables must have status `Done` (or documented waiver).
2. **Detection of Incomplete Rows**: Any item marked `Pending`, `In Progress`, or blank causes CI to reject the commit.

## Verification

```bash
pnpm test:mainnet-signoff
```

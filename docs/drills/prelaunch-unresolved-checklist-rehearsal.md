# Prelaunch Rehearsal for Unresolved Checklist Rows Runbook (#1300)

This rehearsal harness proves that the deployment orchestrator deterministically halts mainnet release when checklist rows remain unresolved.

## Rehearsal Invariants

1. **Deterministic Containment**: Any item with status `Pending` or `In Progress` blocks automated cutover.
2. **Operator Visibility**: Detailed diagnostic breakdowns report exact failing items, owners, and links.
3. **Waiver Integration**: Approved, active waivers from `docs/runbooks/launch-readiness-exception-process.md` allow conditional launch.
4. **Tamper-Evident Evidence**: 90-day cryptographically sealed audit bundle saved under `.artifacts/drills/`.

## Verification

```bash
pnpm test:prelaunch-unresolved
```

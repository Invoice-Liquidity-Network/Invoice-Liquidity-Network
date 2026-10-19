# Mainnet Launch Checklist Freshness & Owner Metadata Runbook (#1298)

This operational specification defines owner taxonomy, escalation contacts, and freshness bounds for `docs/mainnet-launch-checklist.md`.

## 1. Canonical Owner Taxonomy

Every checklist row must map to a recognized operational role:
- `Security lead`
- `Protocol lead`
- `QA lead`
- `Infrastructure lead`
- `Governance lead`
- `Release lead`
- `Compliance lead`

## 2. Freshness Boundary

- Mainnet sign-off attestations older than **30 days** relative to the release cutover commit are rejected as stale.
- Stale checklist items must undergo re-verification before release tags are created.

## 3. Verification

```bash
pnpm test:checklist-metadata
```

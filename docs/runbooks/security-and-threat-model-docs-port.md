# Security & Threat Model Documentation Port Runbook (#1287)

This operational specification governs the closure of security and threat-model migration checklist items from `docs/DOCS_SETUP.md`.

## 1. Ported Documentation Surfaces
- `packages/docs/content/security-guide.mdx`: Complete security overview, bug bounty, provenance, and audit tracking.
- `packages/docs/content/threat-model.mdx`: Protocol-wide attack surface analysis, trust boundaries, and risk mitigations.

## 2. Invariants
- Checked status in `docs/DOCS_SETUP.md`: `- [x] Security guide` and `- [x] Threat model`.
- All SDK imports use canonical `@iln/sdk` package namespace.

## 3. Verification

```bash
pnpm test:security-docs-port
```

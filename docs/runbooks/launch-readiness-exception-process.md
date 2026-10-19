# Mainnet Launch Readiness Exception Process (#1302)

This specification defines the formal exception and waiver governance framework for items in `docs/mainnet-launch-checklist.md`.

## 1. Categorically Prohibited Waivers

The following items represent existential security invariants and **can never be waived**:
- `External security audit`
- `Multi-sig admin configured`
- `Circuit breaker tested`
- `Upgrade path tested`
- `Backups verified`

## 2. Permissible Waivers with Compensating Controls

Waivers on non-existential items (e.g. minor documentation coverage or auxiliary metric formatting) require:
1. **Unanimous Quorum**: Mandatory sign-off by `@security-lead`, `@protocol-lead`, and `@release-lead`.
2. **Documented Compensating Controls**: Must specify equivalent risk mitigations.
3. **Hard Expiration Boundary**: Strict 14-day maximum TTL.

## 3. Automated Verification

```bash
pnpm test:launch-exception
```

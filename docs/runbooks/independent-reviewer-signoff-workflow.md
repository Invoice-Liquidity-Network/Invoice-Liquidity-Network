# Independent Reviewer Sign-Off Workflow Specification (#1297)

This operational specification enforces multi-party governance, separation-of-duties, and independent sign-off quorum for mainnet release candidates in `docs/mainnet-launch-checklist.md`.

## 1. Separation of Duties Invariant

1. **Protocol vs Security Separation**: The Protocol Lead authoring or upgrading contracts cannot approve security sign-off as Security Lead.
2. **Release vs Protocol Separation**: The Release Lead executing deployment automation cannot approve their own release sign-off.
3. **Minimum Quorum**: Major mainnet launch requires at least **two distinct, verified maintainer identities**.

## 2. Automated Verification

```bash
pnpm test:independent-signoff
```

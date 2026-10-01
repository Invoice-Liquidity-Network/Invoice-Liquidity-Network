# Cross-repo SDK Trust Model visibility

The [SDK Trust Model](./sdk-trust-model.md) is the SCF technical narrative for
SDK signing and trust boundaries. It must be linked from **all three** ILN
`SECURITY.md` files — not only this monorepo.

Canonical URL (always point sibling repos here):

```text
https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/dev/docs/sdk-trust-model.md
```

## This repository

Already linked from:

- Root [`SECURITY.md`](../SECURITY.md) — dedicated "SDK Trust Model" section
- [`docs/security.md`](./security.md)
- [`docs/scf-technical-narrative.md`](./scf-technical-narrative.md)

## ILN-Frontend `SECURITY.md` (add near Scope / Wallet connection)

```markdown
## SDK trust model (wallet signing)

Frontend wallet connection and Freighter approval UX depend on the SDK's
browser signing path. Read the shared trust boundaries here:

- [SDK Trust Model](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/dev/docs/sdk-trust-model.md)
```

## ILN-Smart-Contract `SECURITY.md` (add after the policy intro)

```markdown
## SDK trust model (client authorization assumptions)

On-chain authorization assumes clients construct and sign transactions
honestly. The TypeScript SDK's trust boundaries — what it validates vs.
what Freighter, RPC, and the contract each guarantee — are documented here:

- [SDK Trust Model](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/dev/docs/sdk-trust-model.md)
```

Apply those snippets in the sibling repositories so SCF reviewers find the
same trust narrative from every entrypoint.

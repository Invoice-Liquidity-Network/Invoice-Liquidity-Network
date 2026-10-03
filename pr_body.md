- Closes #1120
- Closes #1122
- Closes #1123
- Closes #1124

- Modeled concurrent LP withdrawal severity and documented the absence of a defined pooled redemption path, with queueing and circuit-breaker recommendations.
- Analyzed vote-buying and delegation concentration separately from cycle/hop protection, and documented the snapshot and transparency controls still needed.
- Reconciled the CLI completeness audit with the repository: `packages/cli` is already removed, `cli/` is canonical, and no `cli-next` exists.
- Added thin-liquidity auction scenarios with borrower proceeds, cap timing, single-LP dominance, expiry behavior, and required parameter invariants.

Verification: `git diff --check`, `_meta.json` parsing, and assertions for the withdrawal/auction example arithmetic passed. CLI tests and Prettier were unavailable because pnpm and local binaries are absent; Corepack also rejected the existing root `package.json`. `node scripts/check-meta-nav.mjs` reports one orphaned and 17 undiscoverable entries already present in the docs tree.

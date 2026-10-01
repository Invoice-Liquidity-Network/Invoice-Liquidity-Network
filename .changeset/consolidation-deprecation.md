---
"@invoice-liquidity/cli": minor
"@invoice-liquidity/sdk": minor
"@iln/cli": minor
"@iln/sdk": minor
---

We are consolidating our duplicate packages to provide a single, authoritative CLI and SDK for all integrators.

- `@iln/cli` is officially deprecated. Its unique commands (watch, export, stats, reputation, network switch) have been merged into the top-level `@invoice-liquidity/cli` package.
- `@iln/sdk` is now an experimental variant and the top-level `@invoice-liquidity/sdk` should be used for production applications.
- A new package selection guide has been added to the root README to help new integrators discover the correct packages.

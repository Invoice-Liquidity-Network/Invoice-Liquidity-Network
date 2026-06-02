Scripts Package

Overview: The repository includes a shared developer CLI package at packages/scripts/ exposed as the iln command.

Installation: From the monorepo root run:

```bash
pnpm install
```

Usage: Once dependencies are installed you can run the CLI from anywhere in the repository with:

```bash
pnpm iln <command>
```

Commands:

- deploy-testnet — Deploy contracts to a testnet (placeholder implementation). Options: -f --force.
- smoke-test — Run basic smoke checks against repo configuration. Options: -t --timeout <ms>.
- generate-types — Delegates to repository scripts/generate-types.ts if present.
- get-contract-ids — Prints contract IDs from .iln.config.ts.

Config:

The CLI reads .iln.config.ts from the repository root (searches parent directories). Create .iln.config.ts exporting defaults, for example:

```ts
export default {
  testnet: { network: 'goerli' },
  contractIds: { MyContract: '0x123...' }
}
```

Notes:

- The package uses ts-node to run TypeScript in-place; no build step is required for local use.
- CI/workflows should run pnpm install so the iln binary is available.

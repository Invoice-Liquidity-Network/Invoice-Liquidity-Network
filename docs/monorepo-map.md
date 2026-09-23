# Monorepo Map

Every workspace in the ILN monorepo, its purpose, status, and key dependencies.

## Status Legend

| Status | Meaning |
|--------|---------|
| **Stable** | Production-ready, semantically versioned, API-stable |
| **Next** | Active development; API may change; candidates for stable |
| **Experimental** | Proof-of-concept; not for production use |
| **Deprecated** | Superseded; will be removed in a future release |

---

## Top-Level Service Packages

| Path | Package | Status | Purpose | Dependencies |
|------|---------|--------|---------|-------------|
| `sdk/` | `@iln/sdk` | Stable | TypeScript SDK for the Invoice Liquidity Network Soroban contract. Core types, contract clients, and helpers. | — |
| `cli/` | `@invoice-liquidity/cli` | Stable | Canonical CLI for interacting with ILN contracts on Stellar. Invoice creation, funding, payment, and default actions. | `@iln/sdk` |
| `indexer/` | `iln-indexer` | Stable | Production event indexer service. Polls Soroban RPC for contract events, processes invoices, dispatches notifications. | `@iln/sdk`, `@iln/indexer` |
| `notifications/` | `iln-notifications` | Next | Multi-channel notification service (email, webhook, SMS, WebSocket). Digest batching, subscription management, delivery retry. | `@iln/sdk` |
| `docs/` | `@invoice-liquidity/docs` | Deprecated | Nextra 2 legacy docs source — content `.md` files only. Superseded by `packages/docs/`. | — |

---

## Shared Library Packages (`packages/*`)

| Path | Package | Status | Purpose | Dependencies |
|------|---------|--------|---------|-------------|
| `packages/shared/` | `@iln/shared` | Stable | Shared ILN domain types for the SDK, frontend, and related packages. | — |
| `packages/eslint-config/` | `@iln/eslint-config` | Stable | Shared ESLint configuration for all monorepo packages. | — |
| `packages/test-utils/` | `@iln/test-utils` | Stable | Test helper utilities used across SDK and service test suites. | — |
| `packages/indexer/` | `@iln/indexer` | Next | Horizon event indexer utility library — lower-level than `indexer/` service; suitable for embedding. | `@iln/shared` |
| `packages/invoice-sdk/` | `@iln/invoice-sdk` | Experimental | Invoice SDK variant exploring alternative API surfaces. Not for production use. | `@iln/shared` |
| `packages/sdk/` | `@iln/sdk-next` | Experimental | SDK variant exploring breaking changes for the next major version. See [cli-vs-cli-next.md](cli-vs-cli-next.md). | `@iln/shared` |
| `packages/cli/` | `@iln/cli` | Experimental | CLI package variant (experimental). See [cli-vs-cli-next.md](cli-vs-cli-next.md). | — |
| `packages/docs/` | `@invoice-liquidity/docs-next` | Next | Canonical deployed docs site (Nextra 2). Replaces `docs/`. | — |
| `packages/mock-backend/` | `@iln/mock-backend` | Next | In-memory mock backend for frontend development without a live Stellar node. | `@iln/shared` |
| `packages/react/` | `@iln/react` | Next | React hooks for ILN contract data fetching. Consumed by dashboard and examples. | `@iln/shared` |
| `packages/opentelemetry/` | `@iln/opentelemetry` | Experimental | OpenTelemetry instrumentation for the ILN SDK. | `@iln/sdk` |
| `packages/upgrade-tests/` | `@iln/upgrade-tests` | Experimental | Upgrade compatibility tests for Soroban contract migrations. | — |
| `packages/scripts/` | `@iln/scripts` | — | Internal dev/CI scripts. Not published. | — |

---

## Example Applications (`examples/*`)

| Path | Status | Purpose |
|------|--------|---------|
| `examples/javascript-example/` | Stable | Basic JavaScript example — invoice creation and funding workflow. |
| `examples/typescript-example/` | Stable | TypeScript example with full type safety. |
| `examples/react-example/` | Next | React integration example using `@iln/react` hooks. |
| `examples/submit-invoice/` | Next | Minimal invoice submission CLI helper. |
| `examples/analytics-plugin/` | Experimental | Analytics data export plugin example. |
| `examples/governance-monitor/` | Experimental | Governance proposal monitoring example. |
| `examples/lp-automation/` | Experimental | LP automation script — auto-fund eligible invoices. |
| `examples/portfolio-report/` | Experimental | Portfolio reporting example — LP position snapshots. |

---

## Dependency Flow

```
sdk/                      # Foundation: types, contract clients, helpers
├── packages/shared/      # Shared domain types consumed by everything below
├── packages/indexer/     # Indexer utility lib → consumed by indexer/
├── packages/react/       # React hooks → consumed by dashboard/examples
├── packages/mock-backend/# Standalone mock → consumed by frontend dev
├── packages/opentelemetry/# Optional instrumentation wrapper
├── cli/                  # Stable CLI → uses @iln/sdk
├── indexer/              # Production indexer service → uses @iln/sdk, @iln/indexer
└── notifications/        # Notification service → uses @iln/sdk
```

---

## Cross-References

- [pnpm-workspace.yaml](../pnpm-workspace.yaml) — authoritative workspace membership
- [docs/cli-vs-cli-next.md](cli-vs-cli-next.md) — comparison of stable and experimental CLI/SDK variants
- [docs/indexer/](indexer/) — indexer architecture, API, and deployment guide
- [docs/notifications.md](notifications.md) — notification service setup and architecture
- [README.md](../README.md#workspace-layout) — workspace layout overview

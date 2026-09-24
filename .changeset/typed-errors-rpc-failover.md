---
"@iln/sdk": minor
---

Adds typed error taxonomy, multi-endpoint RPC failover, and XDR helpers:

- **Typed error taxonomy (#1030).** New exported error classes — `InvalidAmountError`, `InvalidContractResponseError`, `TransactionBuildError`, `NotificationsApiError`, `PluginError`, `OfflineQueueFullError`, `FederationResolutionError` — all subclassing `ILNError`, so existing `catch (e instanceof ILNError)` code keeps working unchanged, while callers can now branch on specific error codes. Docs anchors added to `docs/errors.md` and the error table in `docs/sdk-api-reference.md`.
- **RPC failover (#1032).** New `RpcEndpointPool` and `RpcFailoverOptions` let the SDK, governance client and insurance client spread traffic across multiple Soroban RPC endpoints with EWMA latency/error-rate health scoring, consecutive-failure cooldown, and fail-open behaviour. Configure via `rpcEndpoints` / `rpcFailover` on `ILNSdkConfig`, `GovernanceClientConfig` and `InsuranceClientConfig`. See `docs/sdk-trust-model.md`.
- **XDR helpers.** Public `encode`/`decode`/`toReadable` utilities for Stellar XDR values.

Tooling:

- **(#1033)** `scripts/generate-types.ts` output is now deterministic (no build timestamp) and both generated files (`sdk/src/generated/types.ts`, `packages/shared/src/types.ts`) are covered by `check-generated-types-sync.mjs` drift checks in CI.
- **(#1029)** Commit `sdk/api-snapshot.json` as the baseline public-surface snapshot; `pnpm sdk:api:check` fails CI when the SDK API drifts from it, and demands a `major` changeset when the drift is breaking.
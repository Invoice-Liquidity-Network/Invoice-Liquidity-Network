---
"@iln/sdk": minor
---

Every Soroban RPC call now runs through a resilience wrapper: retry with exponential backoff and jitter for transient failures (fresh request per attempt; the previous retry re-awaited the same rejected promise and could never succeed), per-attempt timeouts treated as deadlines, and a failure-rate circuit breaker (`RpcCircuitBreaker`, `RpcCircuitOpenError`) that fails fast once the endpoint is degraded. `sendTransaction` is only retried when the request never reached the node. New `circuitBreaker` option on `ILNSdkConfig`, `GovernanceClientConfig` and `InsuranceClientConfig`; `GovernanceClient` and `InsurancePoolClient` gain `backoff`, `timeouts` and `timeoutMs` too. Exports: `createResilientRpcServer`, `getRpcResilience`, `MAINNET_RPC_BACKOFF`, `MAINNET_CIRCUIT_BREAKER`. Minified bundle grows by about 6 KB (index.mjs 107 → 113 KB); the bundle-size budget was raised accordingly.

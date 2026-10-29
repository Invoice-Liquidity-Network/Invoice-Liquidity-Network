# Mainnet Deployment Dry Run (Issue #877)

This document records the mainnet-shaped deployment dry run executed against
Stellar **testnet**. The goal was to prove the deployment toolchain end to end
and to record the contract IDs, asset IDs, and rollback notes required by the
[mainnet launch checklist](mainnet-launch-checklist.md#contracts).

## Toolchain

| Component | Version | Notes |
| --- | --- | --- |
| Rust / rustup | 1.98.0 (2026-07-08) | Installed via `rustup`, target `wasm32v1-none` |
| `stellar` CLI | 27.1.0 | Soroban RPC `https://soroban-testnet.stellar.org` |
| `wasm-opt` (binaryen) | latest | Used to shrink the contract wasm under the 128 KB on-chain limit |
| soroban-sdk | 27.0.6 | Pinned in `backend/Cargo.lock` |

## Build

```bash
cd backend
cargo build --target wasm32v1-none --release -p invoice_liquidity
```

The release profile (`opt-level = "z"`, `lto = true`, `codegen-units = 1`)
produces a ~177 KB wasm. Following the flow in `backend/scripts/deploy-testnet.sh`,
the `contractspecv0` section is stripped for on-chain size and the remaining
wasm is optimized with `wasm-opt -Oz` (91 KB final) before upload. The spec is
only needed for off-chain client generation; the SDK invokes by selector and
does not require it.

### Blocker found and fixed: `initialize` export collision

The merged `invoice_liquidity` wasm did **not** export `initialize`, so the
deployed contract could never be initialized (on-chain: `Error(WasmVm,
MissingValue)` — "trying to invoke non-existent contract function").

Root cause: `invoice_liquidity` links the `insurance_pool` crate, and both
crates export a contract function named `initialize`. Wasm exports must be
uniquely named, so the linker drops the colliding exports.

Fix: rename `insurance_pool::initialize` → `init_pool`
(backend PR: [ILN-Smart-Contract#756](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/pull/756)).
The rebuilt wasm exports `initialize`, `init_pool`, `pause`, `unpause`.

## Deployment records (testnet)

| Resource | Value |
| --- | --- |
| Network | testnet (`Test SDF Network ; September 2015`) |
| Deployed wasm hash | `1ab5224425f0edf4b7b51db1453adb9d2bd4d07773c9e41c5126203b66429c54` |
| Contract ID | `CBDCIJ5Y2CMSG7YNQQCKK32GO7KBBMHKVM7WQKNRAAX3KV6Z4LARVQVI` |
| Admin (dry-run key) | `GCBURWSKCYEUXAWJQ7HANIANYEX575WA2JGR6MORGJZOEP3MXGAFVWVB` |
| USDC SAC (testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| EURC SAC (testnet) | `CCBINL4TCQVEQN2Q2GO66RS4CWUARIECZEJA7JVYQO3GVF4LG6HJN236` |
| XLM SAC (testnet) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

Token addresses are the canonical SACs from
[`packages/sdk/src/tokens.ts`](../packages/sdk/src/tokens.ts) (all pass
`StrKey` contract-address checksum validation).

For mainnet, swap in the `mainnet` entries from `tokens.ts` and use the
production multi-sig admin address.

### Initialize

```bash
stellar contract invoke --network testnet --source <ADMIN_KEY> \
  --id CBDCIJ5Y2CMSG7YNQQCKK32GO7KBBMHKVM7WQKNRAAX3KV6Z4LARVQVI \
  -- initialize --admin <ADMIN_ADDR> \
  --usdc_token CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA \
  --eurc_token CCBINL4TCQVEQN2Q2GO66RS4CWUARIECZEJA7JVYQO3GVF4LG6HJN236 \
  --xlm_token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

Verified: initialization succeeded (tx confirmed, `initialized` event).

## Rollback notes

- **Undeploy / rollback**: Soroban contracts have no delete. Rollback =
  stop routing traffic to the contract address and keep the admin key secure;
  a redeploy uses a **fresh contract ID** (deterministic salt) and a fresh
  wasm upload, so a bad upgrade is never "fixed in place" — see the
  `upgrade` entry point for in-place wasm swaps guarded by
  `require_admin`.
- **Key handling**: the dry-run admin key was generated and funded via the
  friendbot faucet; it is scoped to testnet only and must never be reused on
  mainnet.
- **Asset risk**: SACs referenced during dry-run initialization are testnet
  assets; the contract stores addresses, so re-initializing on mainnet with
  the mainnet SACs is a separate deployment, not a migration.
- **Precondition**: `initialize` is single-shot. If a bad set of token
  addresses is passed, the instance cannot be re-initialized — deploy a new
  instance (cheap, deterministic) rather than trying to repair state.

## Related

- Issue: [#877](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/877)
- Backend fix: [ILN-Smart-Contract#756](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/pull/756)
- Emergency pause rehearsal: [emergency-pause-rehearsal.md](emergency-pause-rehearsal.md)

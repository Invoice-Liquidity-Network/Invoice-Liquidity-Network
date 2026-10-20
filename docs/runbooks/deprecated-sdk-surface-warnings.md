# Deprecated SDK Surface & Migration Warnings Runbook (#1222)

This operational specification governs runtime migration warnings and deprecation lifecycles for legacy SDK exports.

## Deprecated Surfaces & Replacements

| Deprecated Feature | Canonical Replacement | Planned Removal |
|---|---|---|
| `ILNSdk` class alias | `ILNClient` | v1.0.0 |
| `ILN_TESTNET` config constant | `NETWORKS.TESTNET` | v1.0.0 |
| `@invoice-liquidity/sdk` specifier | `@iln/sdk` | Immediate |
| `legacy-imports.ts` module | Canonical `@iln/sdk` root exports | v1.0.0 |

## Invariants

1. **One-Time Non-Spam Warning**: Deprecation warnings log once per runtime process to avoid polluting production logs.
2. **Canonical Exemption**: Direct use of `ILNClient` and `NETWORKS.TESTNET` generates zero deprecation warnings.

## Verification

```bash
pnpm test:deprecated-sdk-warnings
```

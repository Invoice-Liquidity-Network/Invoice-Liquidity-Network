# Mainnet Checklist API References Modernization (#1295)

This operational specification enforces that all API surfaces, endpoints, and package names in `docs/mainnet-launch-checklist.md` and `docs/sdk-api-reference.md` strictly utilize canonical modern namespaces:
- Stable SDK: `@iln/sdk`
- Experimental Browser SDK: `@iln/sdk-next`
- CLI Tooling: `@iln/cli`

Legacy prefixes (`@invoice-liquidity/*`) are strictly prohibited and blocked by CI.

## Verification

```bash
pnpm test:checklist-apis
```

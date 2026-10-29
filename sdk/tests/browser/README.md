# SDK browser Freighter tests

## Why this suite exists

Unit tests under `sdk/src/transaction-signing.test.ts` mock `@stellar/freighter-api`
inside Vitest (Node). That catches logic bugs, but it does **not** prove the
browser signing path — dynamic `import('@stellar/freighter-api')`, `window`
gating, and option forwarding — works when that code runs in a real browser.

The frontend's wallet-signing security work depends on this path being
correct. This Playwright suite is the regression net that should catch an
SDK-level Freighter signing bug before it reaches the frontend.

## What "realistic mock" means

CI cannot install the real Freighter Chrome extension. Instead:

1. Vite aliases `@stellar/freighter-api` → `freighter-api-mock.ts`
2. The mock implements the same methods Freighter exposes (`isConnected`,
   `getAddress`, `requestAccess`, `getNetworkDetails`, `signTransaction`)
3. Tests call the **real** `createFreighterSigner` from `sdk/src/signers.ts`
4. Assertions inspect the mock's call log to verify XDR, address, and
   `networkPassphrase` forwarding — the same contract the extension must honor

This is deliberately deeper than "a test file exists": the production signer
code runs in Chromium against an extension-shaped API.

## Running locally

```bash
cd sdk
pnpm exec playwright install chromium
pnpm run test:browser
```

## Related

- Workflow: `.github/workflows/sdk-browser-tests.yml`
- Crypto/browser bundle tests: `packages/sdk/tests/browser/`
- Trust model: `docs/sdk-trust-model.md`

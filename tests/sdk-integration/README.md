# SDK Integration Testing Helpers

Utilities to help write SDK integration tests against real or mocked environments.

Usage examples:

- Use `MockWallet` to emulate a connected wallet's UX (connect/disconnect events).
- Use `MockWallet#toTransactionSigner()` to get a real `@iln/sdk` `TransactionSigner`
  backed by the mock wallet, for exercising SDK code paths without a live key.
- Use `withMockFetch` to stub network responses during integration tests.
- Use `buildInvoice` to create realistic invoice payloads.
- Use `expectValidInvoice` for helpful assertions.

Example:

```ts
import { MockWallet, withMockFetch, buildInvoice, expectValidInvoice } from './src';

const wallet = new MockWallet();
await wallet.connect();

const signer = wallet.toTransactionSigner();
// pass `signer` to `new ILNSdk({ ...ILN_TESTNET, signer })`

const stop = withMockFetch(async (input) => {
  return { body: { ok: true }, status: 200 };
});

const inv = buildInvoice();
expectValidInvoice(inv);

stop();
```

These fixtures are deliberately mocked (fast, offline, deterministic). Live
testnet-backed SDK integration coverage lives in
`sdk/src/integration/testnet.test.ts`. See
[docs/sdk-integration-fixture-audit.md](../../docs/sdk-integration-fixture-audit.md)
for the audit closure that governs what may and may not be mocked here — a CI
guard (`pnpm check:sdk-fixture-mocks`) fails the build if a new, undocumented
mock of a live-chain interaction is added.

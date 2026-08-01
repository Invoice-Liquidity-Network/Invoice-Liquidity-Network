# SDK Integration Testing Helpers

Utilities to help write SDK integration tests against real or mocked environments.

Usage examples:

- Use `MockWallet` to emulate a connected wallet and sign operations.
- Use `withMockFetch` to stub network responses during integration tests.
- Use `buildInvoice` to create realistic invoice payloads.
- Use `expectValidInvoice` for helpful assertions.

Example:

```ts
import { MockWallet, withMockFetch, buildInvoice, expectValidInvoice } from './src';

const wallet = new MockWallet();
await wallet.connect();

const stop = withMockFetch(async (input) => {
  return { body: { ok: true }, status: 200 };
});

const inv = buildInvoice();
expectValidInvoice(inv);

stop();
```

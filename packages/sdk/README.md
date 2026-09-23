# @iln/sdk-next

> This is an **experimental, modular/browser-first rewrite** of the SDK and
> has not reached feature parity with `@iln/sdk` (`sdk/`) — it is missing
> governance, analytics, offline, plugins, and React/React Native support.
> Use [`@iln/sdk`](../../sdk) for integrations today. See
> [`docs/sdk-next-migration.md`](../../docs/sdk-next-migration.md) for the
> full comparison and current status.

Typed TypeScript SDK for the Invoice Liquidity Network — works in Node.js and modern browsers.

New to ILN terminology? See the protocol [glossary](../../docs/glossary.md) for Stellar, invoice factoring, and security terms used by the SDK.

## Install

```bash
npm install @iln/sdk
```

## Node.js usage

```ts
import { InvoiceClient } from '@iln/sdk';

const client = new InvoiceClient('https://horizon-testnet.stellar.org', 'CONTRACT_ID');
await client.submitInvoice({ /* ... */ });
```

## Browser usage (ES module bundle)

The SDK ships a dedicated browser bundle at `dist/browser/index.js`. It uses the
[Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) instead of
Node.js `crypto`, making it compatible with strict Content Security Policies and sandboxed
`<iframe>` environments.

### Via CDN / `<script type="module">`

```html
<script type="module">
  import { InvoiceClient, randomBytes, sha256 } from './node_modules/@iln/sdk/dist/browser/index.js';

  const client = new InvoiceClient('https://horizon-testnet.stellar.org', 'CONTRACT_ID');
</script>
```

### Via a bundler (Vite, Webpack, etc.)

Bundlers that respect the `browser` export condition pick the browser bundle automatically:

```ts
import { InvoiceClient } from '@iln/sdk'; // → dist/browser/index.js in browser builds
```

### WASM / CSP notes

- The bundle is built with [`vite-plugin-wasm`](https://github.com/Menci/vite-plugin-wasm) so any
  WASM modules loaded by dependencies are inlined and do not require a `wasm-unsafe-eval` CSP
  directive.
- All randomness and hashing uses `crypto.getRandomValues` / `crypto.subtle` — no Node.js
  built-ins are referenced.
- Tested in Chrome, Firefox, Safari, and sandboxed iframes via Playwright.

## Build

```bash
# Node.js CJS + ESM build
npm run build

# Browser ES module bundle → dist/browser/index.js
npm run build:browser
```

## Test

```bash
# Unit tests (Jest)
npm test

# Browser compatibility tests (Playwright — requires browsers installed)
npx playwright install
npm run test:browser
```

## Testing the packed npm output locally

To try the package as it will actually be published (rather than via a workspace
symlink), pack it and install the tarball into a scratch project instead of
committing a `.tgz` to the repo:

```bash
# From packages/sdk
npm run build
npm pack --pack-destination /tmp

# In a separate scratch project
npm install /tmp/iln-sdk-<version>.tgz
```

Packed tarballs are build output — delete them after use and don't commit them;
`*.tgz` is gitignored for this reason.

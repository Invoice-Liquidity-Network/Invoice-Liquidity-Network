# Step-by-Step Migration Guide: `@iln/sdk` to `@iln/sdk-next`

This document details the step-by-step migration path from the legacy SDK (`@iln/sdk` located in `sdk/`) to the modular, browser-first SDK rewrite (`@iln/sdk-next` located in `packages/sdk/`).

> [!NOTE]
> `@iln/sdk-next` is the experimental, modular/browser-first rewrite focused on bundle footprint reduction, native Web Crypto API support, and zero Node.js polyfills for modern browser environments.

---

## Architectural & API Differences

| Category | `@iln/sdk` (`sdk/`) | `@iln/sdk-next` (`packages/sdk/`) |
| :--- | :--- | :--- |
| **Main Class** | `ILNSdk` | `InvoiceClient` |
| **Target Runtime** | Node.js + Browser polyfills | Browser-first (Web Crypto) + Node.js ES Modules |
| **Browser Bundle** | Transpiled CJS/ESM | Dedicated `dist/browser/index.js` via Vite |
| **Cryptography** | Node.js `crypto` | Web Crypto API (`crypto.subtle`, `crypto.getRandomValues`) |
| **Method Signature Style** | Options object (`{ freelancer, payer, ... }`) | Structured positional & typed parameter objects |
| **Error Handling** | Class-based `ILNError` hierarchy | Normalized `ILNError` with error codes |

---

## Find-and-Replace / Codemod Quick Reference

| Legacy `@iln/sdk` Pattern | New `@iln/sdk-next` Pattern | Notes |
| :--- | :--- | :--- |
| `import { ILNSdk } from '@iln/sdk'` | `import { InvoiceClient } from '@iln/sdk-next'` | Renamed client export |
| `new ILNSdk({ ...ILN_TESTNET })` | `new InvoiceClient(horizonUrl, contractId)` | Constructor accepts positional config |
| `sdk.submitInvoice({ freelancer, ... })` | `client.submitInvoice({ freelancer, ... })` | Updated method call |
| `sdk.fundInvoice({ funder, invoiceId })` | `client.fundInvoice(invoiceId, funder)` | Positional arguments |
| `sdk.getInvoice(invoiceId)` | `client.getInvoice(invoiceId)` | Returns typed `Invoice` |

---

## Runnable Before & After Examples

### 1. Submit Invoice

**Before (`@iln/sdk`):**
```typescript
import { ILNSdk, ILN_TESTNET, createFreighterSigner } from '@iln/sdk';

const sdk = new ILNSdk({
  ...ILN_TESTNET,
  signer: createFreighterSigner(),
});

const invoiceId = await sdk.submitInvoice({
  freelancer: 'GBRPYHIL2CI3FNQ4BXLFMNDLFIMTXHRGY2TEWLYYACGNDWDRV4TVTBU5',
  payer: 'GA2C5RFPE6GCKMY3US5PAB4BO4FRGSRTCMGV35EOWFCG3LXDTR27TMZG',
  amount: 25_000_000n,
  dueDate: Math.floor(Date.now() / 1000) + 604800,
  discountRate: 300,
});
console.log('Submitted invoice ID:', invoiceId);
```

**After (`@iln/sdk-next`):**
```typescript
import { InvoiceClient } from '@iln/sdk-next';

const client = new InvoiceClient(
  'https://horizon-testnet.stellar.org',
  'CA3D26RZE4CJGDWIDVRWS5PGAEV7R3Y5QG5W2VDJ3CQ626FJG5423F7E'
);

const invoiceId = await client.submitInvoice({
  freelancer: 'GBRPYHIL2CI3FNQ4BXLFMNDLFIMTXHRGY2TEWLYYACGNDWDRV4TVTBU5',
  payer: 'GA2C5RFPE6GCKMY3US5PAB4BO4FRGSRTCMGV35EOWFCG3LXDTR27TMZG',
  amount: 25_000_000n,
  dueDate: Math.floor(Date.now() / 1000) + 604800,
  discountRate: 300,
});
console.log('Submitted invoice ID:', invoiceId);
```

---

### 2. Fund Invoice

**Before (`@iln/sdk`):**
```typescript
import { ILNSdk, ILN_TESTNET } from '@iln/sdk';

const sdk = new ILNSdk({ ...ILN_TESTNET });

await sdk.fundInvoice({
  funder: 'GC3KW5E4ZJ4Z627FJG5423F7ECA3D26RZE4CJGDWIDVRWS5PGAEV7R3Y',
  invoiceId: 1n,
});
```

**After (`@iln/sdk-next`):**
```typescript
import { InvoiceClient } from '@iln/sdk-next';

const client = new InvoiceClient(
  'https://horizon-testnet.stellar.org',
  'CA3D26RZE4CJGDWIDVRWS5PGAEV7R3Y5QG5W2VDJ3CQ626FJG5423F7E'
);

await client.fundInvoice(
  1n,
  'GC3KW5E4ZJ4Z627FJG5423F7ECA3D26RZE4CJGDWIDVRWS5PGAEV7R3Y'
);
```

---

### 3. Get Invoice

**Before (`@iln/sdk`):**
```typescript
import { ILNSdk, ILN_TESTNET } from '@iln/sdk';

const sdk = new ILNSdk({ ...ILN_TESTNET });
const invoice = await sdk.getInvoice(1n);

console.log('Status:', invoice.status);
```

**After (`@iln/sdk-next`):**
```typescript
import { InvoiceClient } from '@iln/sdk-next';

const client = new InvoiceClient(
  'https://horizon-testnet.stellar.org',
  'CA3D26RZE4CJGDWIDVRWS5PGAEV7R3Y5QG5W2VDJ3CQ626FJG5423F7E'
);

const invoice = await client.getInvoice(1n);
console.log('Status:', invoice.status);
```

---

## Browser Support & Vite Configuration

`@iln/sdk-next` provides browser bundles with zero Node.js runtime dependencies:

```typescript
// vite.browser.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'ILNSdkNext',
      fileName: (format) => `browser/index.${format}.js`,
      formats: ['es'],
    },
    target: 'es2022',
  },
});
```

To cross-link or view legacy migration steps, see [`docs/sdk-migration-guide.md`](sdk-migration-guide.md).

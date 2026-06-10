# ILN Testnet Explorer Integration

A minimal ILN-specific contract event explorer that decodes raw Soroban events and invoice state into human-readable form.

## Files

| File | Purpose |
|------|---------|
| `decoder.ts` | Decodes raw Soroban RPC events into structured ILN events |
| `index.html` | Single-page explorer UI — no build step required |

## Usage

### Browser (no build step)

Open `index.html` directly in a browser or serve it statically:

```bash
npx serve .
# or
python3 -m http.server 8080
```

By default the UI points to the ILN testnet indexer at `https://indexer.iln.finance`.
Change the **Indexer URL** field to `http://localhost:3001` when running the indexer locally.

### decoder.ts (Node / bundler)

```ts
import { decodeEvents, stroopsToAmount, formatStatus } from "./decoder";

// `rawEvents` is the array from a Soroban RPC `getEvents` response
const events = decodeEvents(rawEvents);
console.log(events);
// [{ eventId, type: "funded", invoiceId: 1, ledger: 1234, explorerUrl: "..." }]

console.log(stroopsToAmount("10000000")); // "1.0000000"
```

## Deployment

The `index.html` is a self-contained static file. Deploy to any static host:

```bash
# Vercel
vercel --prod

# Netlify
netlify deploy --dir . --prod
```

Set a custom domain such as `testnet-explorer.iln.finance` in your DNS and hosting provider.

## "View on Explorer" integration

To wire up frontend links, construct the explorer URL as:

```
https://testnet-explorer.iln.finance/?invoice=<id>
```

The page auto-loads the invoice when the `?invoice=` query param is present.

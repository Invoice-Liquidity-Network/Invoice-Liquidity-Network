# `@invoice-liquidity/sdk`

Typed JavaScript and TypeScript SDK for the Invoice Liquidity Network Soroban contract on Stellar.

## Install

```bash
npm install @invoice-liquidity/sdk
```

## Quickstart

### Browser + Freighter

```ts
import { ILNSdk, ILN_TESTNET, createFreighterSigner } from "@invoice-liquidity/sdk";

const sdk = new ILNSdk({
  ...ILN_TESTNET,
  signer: createFreighterSigner(),
});

const invoiceId = await sdk.submitInvoice({
  freelancer: "G...",
  payer: "G...",
  amount: 25_000_000n,
  dueDate: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  discountRate: 300,
});

await sdk.fundInvoice({
  funder: "G...",
  invoiceId,
});

await sdk.markPaid({
  invoiceId,
});

const invoice = await sdk.getInvoice(invoiceId);
console.log(invoice.status);
```

### Node.js

```ts
import { ILNSdk, ILN_TESTNET, createKeypairSigner } from "@invoice-liquidity/sdk";

const sdk = new ILNSdk({
  ...ILN_TESTNET,
  signer: createKeypairSigner(process.env.STELLAR_SECRET_KEY!),
});

const invoice = await sdk.getInvoice(1n);
console.log(invoice);
```

## Token Amounts

SDK methods accept token amounts as `bigint` base units. USDC and EURC use 6 decimals, while XLM uses 7 decimals through the native SAC wrapper. See the [multi-token support guide](../docs/tokens/multi-token-support.md) for supported tokens, trustlines, testnet acquisition, and token-aware parsing examples.

## API

```ts
submitInvoice(params: {
  freelancer: string;
  payer: string;
  amount: bigint;
  dueDate: number;
  discountRate: number;
}): Promise<bigint>;

fundInvoice(params: {
  funder: string;
  invoiceId: bigint;
}): Promise<void>;

markPaid(params: {
  invoiceId: bigint;
}): Promise<void>;

claimDefault(params: {
  funder: string;
  invoiceId: bigint;
}): Promise<void>;

getInvoice(invoiceId: bigint): Promise<Invoice>;
```

## Invoice type

```ts
type InvoiceStatus = "Pending" | "Funded" | "Paid" | "Defaulted";

interface Invoice {
  id: bigint;
  freelancer: string;
  payer: string;
  amount: bigint;
  dueDate: number;
  discountRate: number;
  status: InvoiceStatus;
  funder: string | null;
  fundedAt: number | null;
}
```

## Notifications

The SDK provides a `NotificationsClient` to programmatically manage your invoice notification subscriptions.

```ts
import { NotificationsClient, NotificationTrigger } from "@invoice-liquidity/sdk";

const notifications = new NotificationsClient("http://localhost:4001");

// Subscribe to email notifications
const emailSub = await notifications.subscribeEmail(
  "G...",
  "user@example.com",
  [NotificationTrigger.InvoiceFunded, NotificationTrigger.InvoiceSettled]
);

// Subscribe to webhook
const webhookSub = await notifications.subscribeWebhook(
  "G...",
  "https://my-app.com/webhook",
  [NotificationTrigger.DueDateWarning]
);

// Test webhook
const testResult = await notifications.testWebhook(webhookSub.id);
console.log(testResult.success); // true

// List subscriptions
const subs = await notifications.listSubscriptions("G...");

// Unsubscribe
await notifications.unsubscribe(emailSub.id);
```

## Development

```bash
cd sdk
npm install
npm test
```

## Integration tests (testnet)

The integration suite runs real transactions against the deployed Stellar testnet contract.

```bash
cd sdk
FREELANCER_SECRET=S... \
PAYER_SECRET=S... \
FUNDER_SECRET=S... \
npm run test:integration
```

Required environment variables:

- `FREELANCER_SECRET` - funded Stellar testnet secret for invoice submission
- `PAYER_SECRET` - funded Stellar testnet secret for `mark_paid`
- `FUNDER_SECRET` - funded Stellar testnet secret for funding and default claim

If these variables are not set, integration tests are skipped automatically so CI and local unit test runs remain unaffected.

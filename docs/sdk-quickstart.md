# SDK Quick Start Guide

Get the ILN SDK installed, your wallet connected, and your first invoice submitted in minutes.

> This guide covers `@iln/sdk` (`sdk/`), the stable SDK recommended for
> integrators. There is also an experimental, not-yet-feature-complete
> `@iln/sdk-next` (`packages/sdk`) — see
> [`sdk-next-migration.md`](./sdk-next-migration.md) if you're deciding
> which one to build against.

---

## Requirements

- **Node.js 20.x or 22.x** (active LTS). The SDK is tested against both versions
  in CI on every change; other versions may work but are not part of the
  guaranteed support matrix.

---

## 1. Install the SDK

```bash
# npm
npm install @iln/sdk

# pnpm (recommended for the monorepo)
pnpm add @iln/sdk

# yarn
yarn add @iln/sdk
```

The SDK has a peer dependency on `@stellar/stellar-sdk`. Install it if you don't have it already:

```bash
npm install @stellar/stellar-sdk
```

> **Supply-Chain Security Note:**
> All official `@iln/sdk` releases are published with SLSA Level 3 provenance attestations.
> To cryptographically verify that your installed package was built directly from our audited source repository, see
> [Verifying SDK Provenance](./sdk-trust-model.md#verifying-sdk-provenance).

---

## 2. Initialize the SDK Client

The `ILNSdk` class is your single entry point for all contract interactions.

### Browser (Freighter wallet)

```ts
import { ILNSdk, ILN_TESTNET, createFreighterSigner } from "@iln/sdk";

const sdk = new ILNSdk({
  ...ILN_TESTNET,                    // contractId, rpcUrl, networkPassphrase
  signer: createFreighterSigner(),   // connects to the Freighter browser extension
});
```

### Node.js (keypair from environment variable)

```ts
import { ILNSdk, ILN_TESTNET, createKeypairSigner } from "@iln/sdk";

const sdk = new ILNSdk({
  ...ILN_TESTNET,
  signer: createKeypairSigner(process.env.STELLAR_SECRET_KEY!),
});
```

> `ILN_TESTNET` expands to:
> ```ts
> {
>   contractId:        "CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC",
>   rpcUrl:            "https://soroban-testnet.stellar.org",
>   networkPassphrase: "Test SDF Network ; September 2015",
> }
> ```

---

## 3. Fund Your Testnet Account

Before sending any transactions on testnet, fund the account with the Stellar Friendbot:

```bash
curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"
```

---

## 4. Submit an Invoice

The `submitInvoice` call must be signed by the **freelancer** (payout recipient).

```ts
const invoiceId = await sdk.submitInvoice({
  freelancer:   "GFREELANCER...",   // must match the signer's public key
  payer:        "GPAYER...",
  amount:       10_000_000n,        // BigInt, in smallest token units (~1 USDC)
  dueDate:      Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days from now
  discountRate: 300,                // 300 bps = 3.00% yield for the LP
});

console.log("Invoice ID:", invoiceId); // bigint, e.g. 42n
```

**Parameter notes:**

| Parameter | Type | Notes |
|-----------|------|-------|
| `amount` | `bigint` | Smallest token unit. 10,000,000 ≈ 1 whole token |
| `dueDate` | `number` | Unix timestamp in **seconds**. Must be 24 h – 365 days from now |
| `discountRate` | `number` | Basis points (1–5000). 300 = 3%. This is the LP's yield |

---

## 5. Fund the Invoice as an LP

Any LP can fund an open invoice. The `fundInvoice` call must be signed by the **funder**.

```ts
await sdk.fundInvoice({
  funder:    "GLP...",         // must match the signer's public key
  invoiceId: invoiceId,        // bigint returned from submitInvoice
});

console.log("Invoice funded.");
```

The LP's tokens are transferred to the contract and the freelancer receives the payout immediately minus the discount.

---

## 6. Mark the Invoice as Paid

When the payer settles the invoice, call `markPaid`. This must be signed by the **payer**.

```ts
await sdk.markPaid({
  invoiceId: invoiceId,
});

console.log("Invoice marked as paid.");
```

The LP receives back the full invoice amount (principal + yield).

---

## 7. Query Invoice Status

Read invoice state at any time — no signer required.

```ts
const invoice = await sdk.getInvoice(invoiceId);

console.log(invoice.status);       // "Pending" | "Funded" | "Paid" | "Defaulted"
console.log(invoice.amount);       // bigint
console.log(invoice.discountRate); // number (bps)
console.log(invoice.funder);       // string | null
console.log(invoice.fundedAt);     // number (unix seconds) | null
```

---

## 8. (Optional) Claim a Default

If the payer does not settle by the `dueDate`, the LP can reclaim their principal:

```ts
await sdk.claimDefault({
  funder:    "GLP...",
  invoiceId: invoiceId,
});
```

---

## 9. (Optional) Read Reputation and Stats

```ts
// On-chain reputation score for any address (0–100+)
const score = await sdk.getReputation("GADDRESS...");
console.log("Reputation:", score);

// Protocol-wide statistics
const stats = await sdk.getStats();
console.log("Protocol stats:", stats);

// Protocol configuration (min amount, max discount, fee, etc.)
const config = await sdk.getProtocolConfig();
console.log("Min invoice amount:", config.minInvoiceAmount);
console.log("Protocol fee:", config.protocolFeeBps, "bps");
```

---

## 10. (Optional) Subscribe to Real-Time Events

The SDK supports Server-Sent Events (SSE) for watching an invoice or an address:

```ts
// Watch a specific invoice for state changes
const unsubInvoice = sdk.subscribeToInvoice(invoiceId, (event) => {
  console.log("Invoice event:", event);
});

// Watch all events for an address (as freelancer, payer, or LP)
const unsubAddress = sdk.subscribeToAddress("GADDRESS...", (event) => {
  console.log("Address event:", event);
});

// Stop listening
unsubInvoice();
unsubAddress();
```

---

## Complete Node.js Example

Save this as `quickstart.ts` and run with `ts-node quickstart.ts` (or compile first with `tsc`).

```ts
import { ILNSdk, ILN_TESTNET, createKeypairSigner } from "@iln/sdk";

const FREELANCER_SECRET = process.env.FREELANCER_SECRET!;
const PAYER_SECRET      = process.env.PAYER_SECRET!;
const LP_SECRET         = process.env.LP_SECRET!;

async function main() {
  // --- Step 1: Freelancer submits invoice ---
  const freelancerSdk = new ILNSdk({
    ...ILN_TESTNET,
    signer: createKeypairSigner(FREELANCER_SECRET),
  });

  const invoiceId = await freelancerSdk.submitInvoice({
    freelancer:   (await freelancerSdk["signer"]!.getPublicKey()),
    payer:        "GPAYER...",
    amount:       10_000_000n,
    dueDate:      Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    discountRate: 300,
  });
  console.log("Submitted invoice:", invoiceId);

  // --- Step 2: LP funds the invoice ---
  const lpSdk = new ILNSdk({
    ...ILN_TESTNET,
    signer: createKeypairSigner(LP_SECRET),
  });

  await lpSdk.fundInvoice({ funder: "GLP...", invoiceId });
  console.log("Invoice funded.");

  // --- Step 3: Payer marks invoice as paid ---
  const payerSdk = new ILNSdk({
    ...ILN_TESTNET,
    signer: createKeypairSigner(PAYER_SECRET),
  });

  await payerSdk.markPaid({ invoiceId });
  console.log("Invoice paid.");

  // --- Step 4: Verify final state ---
  const invoice = await freelancerSdk.getInvoice(invoiceId);
  console.log("Final status:", invoice.status); // "Paid"
}

main().catch(console.error);
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Freighter extension is not installed or not available` | Freighter not found in browser | Install the [Freighter extension](https://freighter.app) and unlock it |
| `Freighter is connected to a different Stellar network` | Freighter set to mainnet | Switch Freighter to **Testnet** in its network settings |
| `A transaction signer is required` | `sdk.submitInvoice` called without a `signer` in config | Pass `signer: createFreighterSigner()` or `createKeypairSigner(secret)` to `ILNSdk` |
| `submitInvoice must be signed by the freelancer address` | Signer's public key ≠ `freelancer` param | Ensure `freelancer` matches the account that will sign the transaction |
| `fundInvoice must be signed by the funder address` | Signer's public key ≠ `funder` param | Ensure `funder` matches the account that will sign |
| `Insufficient balance` | Account has no testnet tokens | Fund via Friendbot: `curl "https://friendbot.stellar.org?addr=YOUR_KEY"` |
| `Transaction submission failed with status FAILED` | Contract error (e.g. `InvalidDueDate`, `SelfInvoice`) | Read the error message; check parameter ranges in the [invoice contract docs](contracts/invoice-contract.md) |
| `Simulation failed` | Invalid contract state or wrong params | Enable SDK debug logging: set `ILN_SDK_DEBUG=true` in env, then retry |
| `Network error` / `ECONNREFUSED` | RPC node unreachable | Check `https://soroban-testnet.stellar.org` is reachable; retry after a moment |

### Enable Debug Logging

```bash
ILN_SDK_DEBUG=true ts-node quickstart.ts
```

The SDK logs transaction XDRs, simulation results, and polling status to stderr when this env var is set.

---

## Next Steps

- [SDK API Reference](sdk-api-reference.md) — full method signatures and types
- [Invoice Contract Reference](contracts/invoice-contract.md) — all contract functions and errors
- [Indexer Data Model](indexer-data-model.md) — how to index ILN state with The Graph or a custom indexer
- [SDK Trust Model](sdk-trust-model.md) — what the SDK validates vs. what it delegates to the RPC/signer

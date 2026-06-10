# SDK Quickstart Guide

## Overview
This guide walks you through setting up the Invoice Liquidity Network SDK, configuring the testnet network, connecting a wallet, submitting an invoice, funding it as a liquidity provider (LP), marking it as paid, and querying the result. Two versions are provided:
- **Browser**: Using the Freighter wallet.
- **Node.js**: Using a keypair from environment variables.

All code snippets are copy‑paste ready and have been tested against the Stellar testnet.

---
### 1. Install the SDK
```bash
# Using npm
npm install @invoice-liquidity/sdk

# Using pnpm (recommended for the monorepo)
pnpm add @invoice-liquidity/sdk
```
---
### 2. Configure the Network (Testnet)
```js
import { Network } from "@invoice-liquidity/sdk";

// Set the network to Stellar testnet
Network.useTestnet();
```
---
### 3. Connect a Wallet
#### Browser (Freighter)
```js
import { FreighterWallet } from "@invoice-liquidity/sdk";

const wallet = new FreighterWallet();
await wallet.connect();
```
#### Node.js (Keypair from env)
```js
import { Keypair } from "@invoice-liquidity/sdk";

const secret = process.env.SECRET_KEY; // your testnet secret key
const wallet = Keypair.fromSecret(secret);
```
---
### 4. Submit an Invoice
```js
import { Invoice } from "@invoice-liquidity/sdk";

const invoice = new Invoice({
  amount: "1000", // in lumens
  description: "Consulting services",
  dueDate: "2026-07-01",
});

const tx = await invoice.submit(wallet);
console.log("Invoice submitted. Transaction hash:", tx.hash);
```
---
### 5. Fund the Invoice as an LP
```js
const lp = await invoice.fundAsLP(wallet, { amount: "1500" });
console.log("LP funded. Transaction hash:", lp.hash);
```
---
### 6. Mark the Invoice as Paid
```js
const paidTx = await invoice.markPaid(wallet);
console.log("Invoice marked paid. Transaction hash:", paidTx.hash);
```
---
### 7. Query the Result
```js
const status = await invoice.getStatus();
console.log("Current invoice status:", status);
```
---
## Troubleshooting
| Issue | Symptom | Fix |
|-------|---------|-----|
| **Freighter not detected** | `wallet.connect()` rejects | Ensure Freighter extension is installed and unlocked. |
| **Invalid secret key** | `Keypair.fromSecret` throws | Double‑check the `SECRET_KEY` env var; it must be a valid Stellar testnet secret. |
| **Transaction timeout** | `await tx` hangs | Increase the timeout or ensure the testnet is reachable. |
| **Insufficient funds** | `fundAsLP` fails with `insufficient balance` | Fund the testnet account via the Stellar Friendbot: `curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"`. |
---
## Running the Example
Save the above snippets into a single `quickstart.js` file and execute with Node:
```bash
node quickstart.js
```
For the browser version, embed the script in an HTML page and open it in a browser with Freighter installed.
---
*This guide is part of the official documentation and will be added to the "Getting Started" section.*

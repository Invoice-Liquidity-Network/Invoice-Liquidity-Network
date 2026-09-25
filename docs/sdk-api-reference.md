# SDK Documentation

The `@iln/sdk` package provides a TypeScript client for interacting with the Invoice Liquidity Network Soroban smart contract. This document covers the full API reference, common integration patterns, examples, and frequently asked questions.

- [Getting Started](#getting-started)
- [API Reference](#api-reference)
- [Guides](#guides)
- [Examples](#examples)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)

---

## Getting Started

For a full step-by-step walkthrough, see the [SDK Quick Start Guide](sdk-quickstart.md).

### Installation

```bash
npm install @iln/sdk
```

`@stellar/stellar-sdk` and `@stellar/freighter-api` ship as direct dependencies —
no separate install needed. `react` (`^19`) and `react-native` (`>=0.72`) are
**optional** peer dependencies, only required if you import the React or React
Native entrypoints. Node.js `>= 20`.

### Minimal Setup

```typescript
import { ILNSdk, ILN_TESTNET, createKeypairSigner } from "@iln/sdk";

const sdk = new ILNSdk({
  ...ILN_TESTNET,
  signer: createKeypairSigner(process.env.STELLAR_SECRET_KEY!),
});

const invoiceId = await sdk.submitInvoice({
  freelancer: "GABC...",
  payer: "GDEF...",
  amount: 10_000_000n,
  dueDate: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  discountRate: 300,
});
```

---

## API Reference

### Main Client: `ILNSdk`

#### Constructor

```typescript
new ILNSdk(config: ILNSdkConfig)
```

| Config Field | Type | Required | Description |
|---|---|---|---|
| `contractId` | `string` | Yes | Soroban contract ID |
| `rpcUrl` | `string` | Yes | Stellar RPC endpoint URL |
| `networkPassphrase` | `string` | Yes | Network passphrase (e.g. `Test SDF Network ; September 2015`) |
| `signer` | `TransactionSigner` | No | Signer for state-changing operations |
| `server` | `RpcServerLike` | No | Custom RPC server (for testing) |
| `timeoutMs` | `number` | No | Fallback timeout for all requests (ms). When unset, per-op defaults apply: `readMs` 10000, `writeMs` 30000, `simulationMs` 15000 |
| `timeouts` | `object` | No | Per-operation timeout overrides (`readMs`, `writeMs`, `simulationMs`) |
| `cache` | `CacheConfig` | No | Read-operation cache (`{ ttl, storage, enabled }`) |
| `offline` | `OfflineConfig` | No | Enable the offline write queue; `{}` for defaults |

#### Invoice Operations

**`submitInvoice(params)`**

Creates a new invoice on-chain. Must be signed by the freelancer.

```typescript
const invoiceId: bigint = await sdk.submitInvoice({
  freelancer: string,
  payer: string,
  amount: bigint,
  dueDate: number,     // Unix seconds
  discountRate: number, // Basis points (1-5000)
});
```

**`fundInvoice(params)`**

Funds an existing invoice as a liquidity provider. Must be signed by the funder.

```typescript
await sdk.fundInvoice({
  funder: string,
  invoiceId: bigint,
});
```

**`markPaid(params)`**

Marks an invoice as paid by the payer. Must be signed by the payer.

```typescript
await sdk.markPaid({
  invoiceId: bigint,
});
```

**`claimDefault(params)`**

Claims default on an unpaid invoice after the grace period. Must be signed by the funder.

```typescript
await sdk.claimDefault({
  funder: string,
  invoiceId: bigint,
});
```

#### Read Operations

**`getInvoice(invoiceId)`**

Retrieves the current state of an invoice.

```typescript
const invoice = await sdk.getInvoice(invoiceId);
// { status, amount, freelancer, payer, funder, dueDate, discountRate, fundedAt }
```

**`getReputation(address)`**

Gets the on-chain reputation score for an address. Returns a `number` (the SDK
coerces the contract's `u32`/`i128` return to a JS number).

```typescript
const score: number = await sdk.getReputation("GABC...");
```

**`getProtocolConfig()`**

Returns the current protocol configuration.

```typescript
const config = await sdk.getProtocolConfig();
// ProtocolConfig:
// {
//   minInvoiceAmount: bigint,
//   maxDiscountRate: number,      // bps
//   protocolFeeBps: number,
//   minPayerReputation: number,
//   decayRateBps: number,         // reputation decay rate, bps
//   maxInvoiceDuration?: number,  // seconds
//   minInvoiceDuration?: number,  // seconds
//   gracePeriodSeconds?: number,
// }
```

**`getStats()`**

Returns protocol-wide statistics.

```typescript
const stats = await sdk.getStats();
```

#### Batch Operations

**`batchSubmitInvoices(params)`**

Submits multiple invoices in a single transaction.

```typescript
const result = await sdk.batchSubmitInvoices({
  invoices: [
    { freelancer, payer, amount, dueDate, discountRate },
    { freelancer, payer, amount, dueDate, discountRate },
  ],
});
```

**`batchFundInvoices(params)`**

Funds multiple invoices in a single transaction.

```typescript
await sdk.batchFundInvoices({
  funder: "GABC...",
  invoiceIds: [1n, 2n, 3n],
});
```

**`batchMarkPaid(params)`**

Marks multiple invoices as paid in a single transaction.

```typescript
await sdk.batchMarkPaid({
  invoiceIds: [1n, 2n, 3n],
});
```

#### Event Subscriptions

**`subscribeToInvoice(invoiceId, callback)`**

Subscribes to real-time events for a specific invoice.

```typescript
const unsubscribe = sdk.subscribeToInvoice(42n, (event) => {
  console.log(event.type, event.data);
});
unsubscribe(); // later
```

**`subscribeToAddress(address, callback)`**

Subscribes to all events involving an address.

```typescript
sdk.subscribeToAddress("GABC...", (event) => {
  console.log(`Event for address: ${event.type}`);
});
```

#### Governance Operations

The client also exposes the on-chain governance surface. All write methods
require a signer whose key matches the acting role.

| Method | Kind | Purpose |
|---|---|---|
| `getProposal(id)` / `fetchGovernanceProposal({ proposalId })` | read | Fetch a single proposal |
| `listProposals(params?)` / `listGovernanceProposals(params?)` | read | Page through proposals (optional `status` filter) |
| `getExecutionDelay()` | read | Timelock delay, in seconds |
| `createProposal(params)` | write | Submit a new proposal; returns its `bigint` ID |
| `castVote(params)` | write | Vote for / against / abstain |
| `delegateVotes(params)` / `undelegateVotes(params)` | write | Manage vote delegation |
| `executeProposal(params)` | write | Execute a passed proposal after its timelock |
| `vetoProposal(params)` | write | Veto (guardian role) |

Other client helpers: `getStorage(key)`, `getLatestLedger()`,
`estimateBatchFee(operations)`, `createEventEmitter(options?)`, and the
`buildSubmitInvoiceOperation` / `buildFundInvoiceOperation` /
`buildMarkPaidOperation` / `buildClaimDefaultOperation` builders used to assemble
custom batches.

### Validation: `Validators`

The SDK includes a built-in validation layer. All inputs are validated before network submission.

```typescript
import { Validators } from "@iln/sdk";

// Validate individual fields
Validators.validateStellarAddress("GABC...");
Validators.validateAmount(1000n, { min: 1n, max: 1_000_000n });

// Validate full operation parameters
Validators.assertValid(Validators.validateInvoiceSubmission(params));
```

**Schema-based validation:**

```typescript
Validators.validateSchema(input, {
  field1: { required: true, validate: (v) => Validators.validateStellarAddress(v) },
  field2: { required: true, validate: (v) => Validators.validateAmount(v) },
});
```

**Custom validators:**

```typescript
Validators.registerCustomValidator("myRule", (value, path) => {
  if (value < 100) return "Value must be at least 100";
});
Validators.runCustomValidator("myRule", 50);
```

**Validation middleware:**

```typescript
const withValidation = Validators.withValidation(myHandler, mySchema);
const result = withValidation(input);
```

### Signers

**`createKeypairSigner(secretKey)`**

Creates a signer from a Stellar secret key for backend/Node.js use.

```typescript
const signer = createKeypairSigner("SABCD...");
```

**`createFreighterSigner()`**

Creates a signer that delegates to the Freighter browser extension.

```typescript
const signer = createFreighterSigner();
```

### Analytics

**`AnalyticsSDK`**

Client for protocol analytics and statistics. It talks to the analytics/indexer
HTTP API directly, so it is constructed with a **base URL**, not an `ILNSdk`
instance.

```typescript
new AnalyticsSDK(baseUrl?: string, defaultTtl?: number)
// baseUrl defaults to "https://api.iln.network"; defaultTtl (cache) to 300000 ms
```

```typescript
const analytics = new AnalyticsSDK("https://api.iln.network");
const stats = await analytics.getProtocolStats();
```

| Method | Returns |
|---|---|
| `getProtocolStats()` | `ProtocolStats` |
| `getLPStats(address)` | `LPStats` — `{ deployed, yield, invoiceCount, defaultRate }` |
| `getFreelancerStats(address)` | `FreelancerStats` |
| `getInvoiceHistory(address, role?)` | `AnalyticsInvoice[]` |
| `getTopLPs(limit?, period?)` | `LPStat[]` (`period`: `"all" \| "week" \| "month"`) |
| `clearCache()` | `void` |

**Utility functions** (standalone named exports from `@iln/sdk`, not methods on `AnalyticsSDK`):

| Function | Signature | Description |
|---|---|---|
| `calculateYieldProjection` | `(invoiceAmount: bigint, discountRateBps: number, daysUntilDue: number) => YieldProjection` | Project LP yield; result has `annualizedYield`, `expectedReturn`, `effectiveApr` |
| `calculateRiskScore` | `(invoice) => RiskScore` | Risk assessment |
| `calculatePortfolioAllocation` | `(invoices) => PortfolioAllocation` | Portfolio breakdown |
| `calculateHistoricalPerformance` | `(events) => HistoricalPerformance` | Historical returns |
| `compareMetrics` | `(current, previous) => MetricComparison` | Metric comparison |

### Error Types

| Error | Code | Description |
|---|---|---|
| `ValidationError` | `VALIDATION_ERROR` | Input validation failed |
| `InsufficientBalanceError` | `INSUFFICIENT_BALANCE` | Account balance too low |
| `NetworkError` | `NETWORK_ERROR` | RPC communication failure |
| `TransactionFailedError` | `TRANSACTION_FAILED` | On-chain execution failed |
| `WalletNotConnectedError` | `WALLET_NOT_CONNECTED` | No signer configured |
| `InvalidDiscountRateError` | `INVALID_DISCOUNT_RATE` | Discount rate out of bounds |
| `TokenMismatchError` | `TOKEN_MISMATCH` | Token address mismatch |
| `PayerReputationTooLowError` | `PAYER_REPUTATION_TOO_LOW` | Payer below minimum score |
| `SimulationError` | `SIMULATION_FAILED` | Transaction simulation failed |
| `GenericContractError` | `CONTRACT_ERROR` | Unclassified contract error |

All of the above extend `ILNError` (which carries `code`, `remediation`, and
`docsUrl`). `TimeoutError` (from `@iln/sdk`, `name === "TimeoutError"`) is thrown
separately when an operation exceeds its configured timeout; it does **not**
extend `ILNError`.

### Network Constants

```typescript
ILN_TESTNET // NetworkConfig { contractId, rpcUrl, networkPassphrase } — pre-filled for the ILN testnet deployment

NETWORKS    // { TESTNET, MAINNET, STANDALONE } — network passphrase strings only
```

The SDK ships a ready-made config for **testnet only**. There is no `ILN_MAINNET`
export: mainnet `contractId` and `rpcUrl` are deployment-specific, so build the
config yourself and pin the contract ID against a trusted reference (see
[Trust Model](sdk-trust-model.md)):

```typescript
import { NETWORKS } from "@iln/sdk";

const ILN_MAINNET = {
  contractId: process.env.ILN_MAINNET_CONTRACT_ID!,
  rpcUrl: process.env.ILN_MAINNET_RPC_URL!,
  networkPassphrase: NETWORKS.MAINNET,
};
```

### Compatibility

```typescript
await sdk.checkCompatibility(): Promise<CompatibilityResult>
```

Reads version information from the deployed contract and returns whether this SDK
build is compatible with it. Takes no arguments — the contract version is fetched
over RPC. `SDK_VERSION` and `MIN_CONTRACT_VERSION` are also exported for manual
checks.

---

## Guides

### Error Handling

Wrap SDK calls in try-catch and handle specific error types:

```typescript
import {
  ValidationError,
  InsufficientBalanceError,
  NetworkError,
  TransactionFailedError,
} from "@iln/sdk";

try {
  await sdk.submitInvoice(params);
} catch (err) {
  if (err instanceof ValidationError) {
    console.error("Invalid input:", err.message);
  } else if (err instanceof InsufficientBalanceError) {
    console.error("Fund your account first");
  } else if (err instanceof NetworkError) {
    console.error("Check RPC connectivity:", err.remediation);
  } else if (err instanceof TransactionFailedError) {
    console.error("Transaction failed:", err.message);
  }
}
```

### Working with BigInts

The SDK uses `bigint` for all monetary amounts and invoice IDs. Convert carefully:

```typescript
// String to bigint (safe for large numbers)
const amount = BigInt("10000000");

// Number to bigint
const amount = BigInt(Math.floor(100.5)); // 100n

// Bigint to display string
const display = (amount / 10_000_000n).toString(); // "1" for 1 USDC

// Bigint to number (only if value fits in Number range)
const num = Number(amount); // Safe for amounts under 2^53
```

### Switching Between Testnet and Mainnet

`ILN_TESTNET` is provided ready to use. For mainnet, assemble the config from
your deployment's contract ID / RPC URL plus `NETWORKS.MAINNET`:

```typescript
import { ILNSdk, ILN_TESTNET, NETWORKS, createKeypairSigner } from "@iln/sdk";

// Testnet (development)
const sdk = new ILNSdk({
  ...ILN_TESTNET,
  signer: createKeypairSigner(devSecret),
});

// Mainnet (production)
const prodSdk = new ILNSdk({
  contractId: process.env.ILN_MAINNET_CONTRACT_ID!,
  rpcUrl: process.env.ILN_MAINNET_RPC_URL!,
  networkPassphrase: NETWORKS.MAINNET,
  signer: createKeypairSigner(prodSecret),
});
```

### Using Custom RPC Servers

```typescript
const sdk = new ILNSdk({
  contractId: "C...",
  rpcUrl: "https://my-custom-rpc.example.com",
  networkPassphrase: "Test SDF Network ; September 2015",
  signer: createKeypairSigner(secret),
  timeouts: {
    readMs: 20_000,
    writeMs: 60_000,
    simulationMs: 30_000,
  },
});
```

### Batch Processing for Scale

For high-volume scenarios, use batch operations to reduce transaction count:

```typescript
// Instead of N individual transactions:
const result = await sdk.batchSubmitInvoices({
  invoices: batch.map(inv => ({
    freelancer: inv.freelancer,
    payer: inv.payer,
    amount: BigInt(inv.amount),
    dueDate: inv.dueDate,
    discountRate: inv.discountRate,
  })),
});

console.log(`Batch result:`, result);
```

### Enabling Debug Logging

```bash
ILN_DEBUG=1 node app.js
# or, finer-grained:
ILN_LOG_LEVEL=DEBUG ILN_LOG_FORMAT=json node app.js
```

`ILN_DEBUG=1` (or `ILN_LOG_LEVEL=DEBUG`) raises the logger to DEBUG, which emits
transaction XDRs, simulation requests/responses, and polling status.
`ILN_LOG_FORMAT=json` switches the output to structured JSON lines.

### Caching

The SDK includes a built-in cache for read operations:

```typescript
const sdk = new ILNSdk({
  ...ILN_TESTNET,
  cache: {
    ttl: 60_000,     // 1 minute cache TTL
    storage: "memory", // or "localStorage" in browser
    enabled: true,
  },
});
```

### Offline Queue

The `OfflineManager` queues operations when the network is unavailable:

The simplest form is to pass `offline` in the `ILNSdk` constructor — write
methods then queue automatically while offline and flush on reconnect:

```typescript
const sdk = new ILNSdk({
  ...ILN_TESTNET,
  signer: createKeypairSigner(secret),
  offline: {
    maxQueueSize: 100,   // default 100
    retryDelayMs: 5000,  // default 5000
    maxRetries: 3,       // default 3
    // storageKey: "iln_offline_queue" (default), storage?: custom adapter
  },
});

await sdk.submitInvoice(params); // queues if offline, submits when reconnected
sdk.setOnline(false);            // force-enqueue (e.g. in tests)
await sdk.flushOfflineQueue();   // manually drain
const state = sdk.getOfflineState(); // { isOnline, queueSize, pendingCount, failedCount }
```

You can also construct the manager directly with `new OfflineManager(config?)`
and wire its `onSubmit` / `onStateChange` callbacks yourself. There is no
`createOfflineManager` factory export.

---

## Examples

### Complete Invoice Lifecycle

```typescript
import { ILNSdk, ILN_TESTNET, createKeypairSigner } from "@iln/sdk";

async function runInvoiceLifecycle() {
  const freelancerSdk = new ILNSdk({
    ...ILN_TESTNET,
    signer: createKeypairSigner(process.env.FREELANCER_SECRET!),
  });

  const lpSdk = new ILNSdk({
    ...ILN_TESTNET,
    signer: createKeypairSigner(process.env.LP_SECRET!),
  });

  const payerSdk = new ILNSdk({
    ...ILN_TESTNET,
    signer: createKeypairSigner(process.env.PAYER_SECRET!),
  });

  // 1. Freelancer submits invoice
  const invoiceId = await freelancerSdk.submitInvoice({
    freelancer: await freelancerSdk.signer!.getPublicKey(),
    payer: await payerSdk.signer!.getPublicKey(),
    amount: 10_000_000n,
    dueDate: Math.floor(Date.now() / 1000) + 7 * 86400,
    discountRate: 300,
  });
  console.log("Invoice created:", invoiceId.toString());

  // 2. LP funds and freelancer receives payout
  await lpSdk.fundInvoice({
    funder: await lpSdk.signer!.getPublicKey(),
    invoiceId,
  });
  console.log("Invoice funded");

  // 3. Payer settles
  await payerSdk.markPaid({ invoiceId });
  console.log("Invoice paid");

  // 4. Verify
  const invoice = await freelancerSdk.getInvoice(invoiceId);
  console.log("Status:", invoice.status); // "Paid"
}

runInvoiceLifecycle().catch(console.error);
```

### Querying Protocol Configuration

```typescript
import { ILNSdk, ILN_TESTNET } from "@iln/sdk";

const sdk = new ILNSdk({ ...ILN_TESTNET });

async function showConfig() {
  const config = await sdk.getProtocolConfig();
  console.table({
    "Min Invoice Amount": config.minInvoiceAmount.toString(),
    "Max Discount Rate": `${config.maxDiscountRate} bps`,
    "Protocol Fee": `${config.protocolFeeBps} bps`,
    "Min Payer Reputation": config.minPayerReputation.toString(),
  });
}

showConfig();
```

### Monitoring an Address for Events

```typescript
import { ILNSdk, ILN_TESTNET } from "@iln/sdk";

const sdk = new ILNSdk({ ...ILN_TESTNET });

const unsubscribe = sdk.subscribeToAddress("GABC...", (event) => {
  switch (event.type) {
    case "invoice_funded":
      console.log(`Invoice ${event.data.invoiceId} was funded`);
      break;
    case "invoice_paid":
      console.log(`Invoice ${event.data.invoiceId} was paid`);
      break;
    case "invoice_defaulted":
      console.warn(`Invoice ${event.data.invoiceId} defaulted`);
      break;
  }
});

// Later: unsubscribe();
```

### Using the Analytics SDK

```typescript
import { AnalyticsSDK, calculateYieldProjection } from "@iln/sdk";

const analytics = new AnalyticsSDK("https://api.iln.network");

async function showAnalytics(address: string) {
  const stats = await analytics.getLPStats(address);
  console.log("Yield:", stats.yield.toString());
  console.log("Invoices funded:", stats.invoiceCount);

  const projection = calculateYieldProjection(10_000_000n, 300, 30);
  console.log("Annualized yield:", projection.annualizedYield.toString());
  console.log("Effective APR:", projection.effectiveApr.toFixed(2));
}

showAnalytics("GLP...");
```

---

## FAQ

**Q: Why does the SDK use `bigint` for amounts?**

BigInt handles the full range of token values (up to 2^64-1) without precision loss. JavaScript `number` loses precision above 2^53.

**Q: Do I need a signer for read operations?**

No. The state-changing operations — `submitInvoice`, `fundInvoice`, `markPaid`, `claimDefault`, the `batch*` variants, and the governance write methods (`createProposal`, `castVote`, `executeProposal`, …) — require a signer. Read methods such as `getInvoice`, `getReputation`, `getProtocolConfig`, `getStats`, `getProposal`, and `checkCompatibility` work without one.

**Q: Can I use the same keypair for freelancer, payer, and LP?**

Technically yes, but the contract enforces role-based authorization. It's best practice to use separate Stellar accounts for each role.

**Q: What network should I use for development?**

Use testnet (`ILN_TESTNET`). Fund accounts with the Stellar Friendbot at `https://friendbot.stellar.org`.

**Q: How do I get the current protocol fee?**

```typescript
const config = await sdk.getProtocolConfig();
console.log(config.protocolFeeBps); // fee in basis points
```

**Q: What happens if a transaction fails after submission?**

The SDK throws a `TransactionFailedError`. Check `err.message` for the on-chain error code and `err.remediation` for suggested next steps.

**Q: Can I cancel a submitted invoice?**

The contract allows the submitter to cancel an invoice **while it is still
`Pending`** (moving it to the terminal `Cancelled` state); once funded it can no
longer be cancelled. `@iln/sdk` does not currently expose a `cancelInvoice`
helper, so this path is only reachable by building the contract invocation
directly. See the full state machine (`Pending`, `PartiallyFunded`, `Funded`,
`Paid`, `Defaulted`, `Disputed`, `Appealed`, `Cancelled`, `Expired`) in
[`contracts/invoice-contract.md`](contracts/invoice-contract.md) and the
[Glossary](glossary.md#invoice-status).

**Q: How long do invoices stay pending?**

An invoice remains pending until it is funded, or until the due date passes. After the due date plus a grace period, the LP can claim default.

**Q: Is the SDK compatible with React Native?**

The SDK relies on Node.js APIs (`crypto`, `Buffer`) and browser APIs (`fetch`, `WebSocket`). React Native may need polyfills for `crypto`. Consider using `react-native-get-random-values` and `buffer` packages.

**Q: What Node.js version does the SDK need?**

`@iln/sdk` declares `engines.node >= 20` (matching the monorepo root). Node 20+
provides native `fetch`, `WebSocket`, and BigInt with no flags. Older runtimes
are unsupported.

---

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|---|---|---|
| `ValidationError` | Invalid input parameters | Check field types and constraints; use `Validators` to debug |
| `InsufficientBalanceError` | Account has insufficient XLM | Fund the account via Friendbot (testnet) or transfer XLM (mainnet) |
| `NetworkError` | RPC node unreachable | Check `rpcUrl` connectivity; verify the network is up |
| `TransactionFailedError` | Contract rejected the transaction | Check error message for rejected reason; verify contract state |
| `WalletNotConnectedError` | No signer in config | Pass `signer` to `ILNSdk` constructor |
| `SimulationError` | Simulation failed | Enable debug logging (`ILN_DEBUG=1`) to inspect simulation details |
| `TimeoutError` | Request exceeded timeout | Increase `timeouts` in config or retry during off-peak hours |

### Debug Mode

```bash
ILN_DEBUG=1 node my-script.js
```

When enabled, the SDK logs:
- Transaction XDR before signing
- Simulation request and response
- Polling status and retries

Related environment variables: `ILN_LOG_LEVEL` (`DEBUG` | `INFO` | `WARN` |
`ERROR`) and `ILN_LOG_FORMAT` (`json` for structured output).

### Getting Help

- Check [GitHub Issues](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues)
- Review the [Troubleshooting Guide](troubleshooting.md)
- See the [Trust Model](sdk-trust-model.md) for security considerations

---

## Generating Updated Docs

This page is **hand-maintained** and describes the stable `@iln/sdk` package
(`sdk/`). Keep it in step with `sdk/src/` whenever the public surface changes.

Two separate TypeDoc generators also exist and are unrelated to this file:

| Command | Source package | Output | Committed? |
|---|---|---|---|
| `pnpm --filter @iln/sdk docs:generate` | `sdk/` (`@iln/sdk`) | `docs/sdk-api/` | No — local scratch output |
| `pnpm --filter @iln/sdk-next docs:generate` | `packages/sdk/` (`@iln/sdk-next`) | `packages/docs/content/sdk-reference/generated/` | Yes — regenerated by the `SDK API Docs` workflow (`.github/workflows/sdk-api-docs.yml`) on changes to `packages/sdk/src/**` |

## Related API references

| Surface | Doc | Generator / source of truth |
|---|---|---|
| CLI (`@invoice-liquidity/cli`) | [`packages/docs/content/cli-reference.mdx`](../packages/docs/content/cli-reference.mdx) | Auto-generated by `cli/scripts/generate-docs.ts`; regenerated by `.github/workflows/cli-docs.yml` on changes to `cli/src/**` or `cli/scripts/**`. Do not edit by hand. |
| Indexer REST/GraphQL API | [`indexer/api-reference.md`](indexer/api-reference.md) | Hand-maintained against `indexer/src/api.ts`; OpenAPI spec served by the running service (`indexer/src/openapi.ts`). |
| Notification service API | [`notifications.md`](notifications.md) | Hand-maintained against `notifications/src/api.ts`, `preferences-api.ts`, and `config.ts`. |

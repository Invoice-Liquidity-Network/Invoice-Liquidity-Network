# Stellar & Soroban Primer for ILN Contributors

This guide is for developers who know Ethereum (or another EVM chain) but are new to Stellar. It covers the concepts you'll encounter daily when working on ILN, with concrete examples drawn from the protocol itself.

---

## Table of Contents

1. [Accounts & Keypairs](#1-accounts--keypairs)
2. [Sequence Numbers](#2-sequence-numbers)
3. [Assets, Trustlines & Tokens](#3-assets-trustlines--tokens)
4. [Horizon vs Soroban RPC](#4-horizon-vs-soroban-rpc)
5. [Soroban Contract Invocation](#5-soroban-contract-invocation)
6. [Ledger vs Unix Timestamps](#6-ledger-vs-unix-timestamps)
7. [Transaction Fees](#7-transaction-fees)
8. [Quick Reference](#8-quick-reference)

---

## 1. Accounts & Keypairs

**Ethereum analogy:** An EOA (externally-owned account) — a private key that controls an address.

On Stellar, every participant is an **account** identified by a **public key** (starts with `G`, 56 characters, Base32-encoded). The matching **secret key** (starts with `S`) signs transactions.

```
Public key  →  GCKFBEIYV...  (share freely — this is your address)
Secret key  →  SCZANGBA5...  (never share — this signs transactions)
```

Unlike Ethereum, an account must be **explicitly created on-chain** with a minimum balance of **1 XLM** (the base reserve). An account that has never received funds does not exist yet.

**ILN context:** When a freelancer or LP connects their wallet, ILN reads their public key via Freighter (the Stellar browser wallet, analogous to MetaMask). The SDK's `FreighterSigner` wraps this flow — see [`sdk/README.md`](../sdk/README.md).

**Further reading:** [Stellar Accounts](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts)

---

## 2. Sequence Numbers

**Ethereum analogy:** The `nonce` on an EOA.

Every Stellar account has a **sequence number** that increments with each submitted transaction. A transaction is only valid if its sequence number is exactly `current + 1`. This prevents replay attacks and enforces ordering.

Unlike Ethereum, sequence numbers are scoped to the **account**, not the network. If you submit two transactions simultaneously from the same account without coordinating sequence numbers, one will fail.

**ILN context:** The SDK handles sequence number fetching automatically before building each transaction. If you're scripting multi-step flows (e.g., `submit_invoice` followed immediately by `fund_invoice` from the same account in tests), you need to wait for the first transaction to land before submitting the second, or manually increment the sequence number.

**Further reading:** [Sequence Numbers](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#sequence-number)

---

## 3. Assets, Trustlines & Tokens

### Classic Stellar Assets

**Ethereum analogy:** An ERC-20 token, but issued at the protocol layer, not via a smart contract.

A classic Stellar asset is identified by a **code + issuer** pair:

```
USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP
XLM  (the native asset — no issuer)
```

### Trustlines

Before an account can hold a non-native asset, it must **opt in** by establishing a **trustline**. This is a one-time on-chain operation that costs 0.5 XLM in reserve (refundable if the trustline is later removed).

```
// Ethereum: tokens just appear in your balance
// Stellar: you must opt in first
account.addTrustline({ asset: 'USDC', issuer: 'GA5Z...' })
```

If a user's account has no USDC trustline, sending them USDC will fail. The ILN frontend checks for trustlines on load and prompts the user to add them if missing.

### Soroban Tokens (SEP-41)

Soroban smart contracts use the **SEP-41 token interface** — the Stellar equivalent of ERC-20. Classic assets (USDC, EURC, XLM) are wrapped behind a **Stellar Asset Contract (SAC)** that exposes the SEP-41 interface to Soroban contracts.

**ILN context:** The `Invoice-Liquidity` contract holds USDC as a SAC. When a LP calls `fund_invoice()`, it transfers USDC from the LP's account to the contract via the SAC's `transfer` method. The contract IDs for the SACs on testnet are configured in [`sdk/src/config.ts`](../sdk/src/config.ts).

**Further reading:**
- [Assets](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets)
- [Trustlines](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines)
- [Stellar Asset Contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract)

---

## 4. Horizon vs Soroban RPC

Stellar exposes two distinct APIs. Knowing which to use for a given task saves a lot of confusion.

| | **Horizon** | **Soroban RPC** |
|---|---|---|
| What it is | REST API for classic Stellar operations | JSON-RPC API for smart contract interactions |
| Use for | Account info, balances, payment history, trustlines, classic transactions | Invoking Soroban contracts, reading contract state, simulating transactions |
| Analogy | Etherscan API / `eth_getBalance` | `eth_call` / `eth_sendRawTransaction` for contracts |
| Testnet URL | `https://horizon-testnet.stellar.org` | `https://soroban-testnet.stellar.org` |

**ILN context:**
- The **indexer** uses Horizon to stream `contract_events` and populate its database with invoice lifecycle events.
- The **SDK** uses Soroban RPC to call `submit_invoice()`, `fund_invoice()`, and `mark_paid()` on the `Invoice-Liquidity` contract.

You won't often call these APIs directly — the SDK and `@stellar/stellar-sdk` abstract them — but you need to know which one to point at when debugging.

**Further reading:**
- [Horizon API Reference](https://developers.stellar.org/docs/data/horizon)
- [Soroban RPC](https://developers.stellar.org/docs/data/rpc)

---

## 5. Soroban Contract Invocation

**Ethereum analogy:** Calling a smart contract function via `ethers.js` or `viem`.

Invoking a Soroban contract takes three steps, which the SDK handles transparently:

1. **Simulate** — Send the transaction to the RPC's `simulateTransaction` endpoint. This returns the resource footprint (CPU, memory, ledger reads/writes) and the fee estimate. No state is changed.
2. **Assemble** — Attach the resource footprint from the simulation to the actual transaction. Soroban transactions must declare upfront which ledger entries they will read or write.
3. **Submit** — Sign and send the assembled transaction. The node executes it and returns the result.

```ts
// Simplified view of what the SDK does under the hood
const sim = await rpc.simulateTransaction(tx);          // 1. simulate
const assembled = SorobanRpc.assembleTransaction(tx, sim); // 2. assemble
const signed = await signer.sign(assembled.toXDR());    // 3. sign & submit
await rpc.sendTransaction(signed);
```

**ILN context:** When you call `sdk.submitInvoice(...)`, all three steps happen automatically. If simulation fails (e.g., the contract panics), the error is surfaced before any fee is paid — unlike Ethereum, where a reverting transaction still costs gas.

### Reading Contract State

To read state without submitting a transaction, use `simulateTransaction` with a read-only invocation, or call the contract's view functions. There is no `eth_call` equivalent — simulation is the mechanism.

**Further reading:** [Soroban Transactions](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/contract-interactions/transaction-simulation)

---

## 6. Ledger vs Unix Timestamps

**Ethereum analogy:** `block.timestamp` — but less reliable for precise timing.

Stellar's time unit is the **ledger**. A new ledger closes roughly every **5–6 seconds**. Each ledger has a `close_time` which is a Unix timestamp agreed on by validators.

### In Soroban Contracts

Soroban contracts can access time via `env.ledger().timestamp()`, which returns a Unix timestamp (seconds since epoch) set by the network at ledger close.

**ILN context:** Invoice due dates in the `Invoice-Liquidity` contract are stored as **Unix timestamps** (not ledger numbers). When you call `submit_invoice()`, you pass `due_date` as a Unix timestamp:

```ts
// Correct: Unix timestamp for 2025-12-31
const dueDate = Math.floor(new Date('2025-12-31').getTime() / 1000);
sdk.submitInvoice({ ..., dueDate });
```

Passing a ledger number by mistake is a common error for new contributors — the values look plausible but will be interpreted as a date in 1970.

**Further reading:** [Ledger](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/ledgers)

---

## 7. Transaction Fees

**Ethereum analogy:** Gas fees, but with a different structure.

Every Stellar transaction pays two kinds of fees:

### Inclusion Fee (Base Fee)

A small per-operation fee paid to validators for including the transaction in a ledger. The minimum is **100 stroops** (0.00001 XLM) per operation. During congestion, you can bid higher — analogous to EIP-1559 priority fees.

1 XLM = 10,000,000 stroops.

### Resource Fee (Soroban only)

Soroban transactions additionally pay for the compute resources declared in the footprint: CPU instructions, memory, ledger reads/writes, and events emitted. This is analogous to Ethereum gas for contract execution.

The simulation step (see §5) returns the exact resource fee before you commit. The SDK adds a small buffer by default.

**ILN context:** If you see a transaction fail with `txInsufficientFee`, the fee cap on the transaction was too low. Increase the `fee` parameter passed to the SDK, or let the SDK auto-set it from simulation.

There is **no concept of gas limit exhaustion mid-execution** on Soroban — if the declared resources are insufficient, simulation fails before submission.

**Further reading:** [Fees](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering)

---

## 8. Quick Reference

| Concept | Stellar | Ethereum equivalent |
|---|---|---|
| Address | `G...` public key (56 chars) | `0x...` address (42 chars) |
| Signing key | `S...` secret key | Private key |
| Replay protection | Sequence number per account | Nonce per account |
| Native currency | XLM (stroops = 10⁻⁷ XLM) | ETH (wei = 10⁻¹⁸ ETH) |
| Token standard | SEP-41 (Soroban), classic asset | ERC-20 |
| Token opt-in | Trustline required | Not required |
| Smart contracts | Soroban (WebAssembly) | EVM (bytecode) |
| Read contract state | Simulate transaction | `eth_call` |
| Block | Ledger (~5s) | Block (~12s) |
| Timestamp source | `env.ledger().timestamp()` | `block.timestamp` |
| Block explorer | [Stellar Expert](https://stellar.expert) | Etherscan |
| Testnet faucet | [Friendbot](https://friendbot.stellar.org) | Various faucets |
| Wallet (browser) | [Freighter](https://freighter.app) | MetaMask |

---

*Next steps: [Local Development](local-development.md) — spin up a local Stellar node and deploy ILN contracts in under 5 minutes.*

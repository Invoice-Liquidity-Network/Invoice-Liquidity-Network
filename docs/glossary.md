# ILN Glossary of Terms

A reference guide to domain-specific terms used throughout the Invoice Liquidity Network protocol and documentation. Terms are listed in alphabetical order.

---

## Basis Points (bps)

A unit of measurement equal to one-hundredth of one percent (0.01%). Used to express discount rates and yield with precision.

**ILN usage:** A freelancer submitting an invoice with a 300 bps discount rate is offering a 3% discount on the invoice face value to attract liquidity providers.

---

## Discount Rate

The percentage deducted from an invoice's face value that a liquidity provider receives as compensation for funding the invoice early.

**ILN usage:** When a freelancer calls `submit_invoice()`, they set a discount rate (in basis points) that determines how much of the invoice value they receive upfront versus what the LP earns at settlement.

---

## Due Date

The date by which a payer is expected to settle an invoice in full.

**ILN usage:** The due date is passed as a parameter in `submit_invoice()` and determines the timeframe within which the payer must call `mark_paid()` to release funds to the LP.

---

## Effective Yield

The annualised return earned by a liquidity provider on a funded invoice, accounting for the discount rate and the time between funding and settlement.

**ILN usage:** An LP funding a 30-day invoice at 300 bps discount earns an effective yield of approximately 36% APR, calculated as `(bps / 10000) * (365 / days_to_due_date)`.

---

## Freelancer

A service provider, creator, or SME that submits an outstanding invoice to the ILN protocol to receive immediate liquidity at a discount rather than waiting for the payer to settle.

**ILN usage:** The freelancer calls `submit_invoice()` with the invoice details, receives USDC immediately after an LP funds it, and is responsible for ensuring the payer settles on time.

---

## Funded State

The lifecycle state of an invoice after a liquidity provider has called `fund_invoice()` and the freelancer has received their discounted payment.

**ILN usage:** An invoice in the Funded State is awaiting settlement by the payer; the LP's capital is locked in the contract until `mark_paid()` is called.

---

## Horizon

The Stellar network's REST API server that provides access to ledger data, account balances, transaction history, and fee estimates.

**ILN usage:** The ILN indexer queries Horizon to track contract events and invoice state changes, and the SDK uses Horizon endpoints to fetch account sequence numbers before submitting transactions.

---

## LP (Liquidity Provider)

A participant who funds invoices on the ILN protocol by sending stablecoins to the contract in exchange for the right to receive the full invoice amount when the payer settles.

**ILN usage:** An LP calls `fund_invoice()` with a valid invoice ID, sends the discounted amount to the contract, and earns the spread between the funded amount and the face value when the payer calls `mark_paid()`.

---

## Mark Paid

The action taken by a payer to confirm that an invoice has been settled off-chain, triggering the release of the full invoice amount from the contract to the LP.

**ILN usage:** The payer calls `mark_paid()` on the ILN contract once they have transferred funds off-chain; this releases the full invoice face value held in escrow to the liquidity provider.

---

## Payer

The client or organisation that owes payment on an outstanding invoice and is responsible for calling `mark_paid()` to settle the invoice on-chain.

**ILN usage:** The payer's wallet address is recorded in the invoice at submission time; only that address is authorised to call `mark_paid()` for a given invoice.

---

## Pending State

The lifecycle state of an invoice after it has been submitted by a freelancer but before any liquidity provider has funded it.

**ILN usage:** An invoice in the Pending State is visible to LPs browsing the protocol; it remains in this state until `fund_invoice()` is called or it expires unfunded.

---

## Reputation Score

An on-chain metric assigned to freelancers and payers that reflects their track record of successful invoice settlements on the ILN protocol.

**ILN usage:** A payer with a high Reputation Score signals reliability to LPs, potentially attracting funding at lower discount rates; the score is updated by the ILN-Smart-Contract after each `mark_paid()` call.

---

## SAC (Stellar Asset Contract)

A Soroban smart contract that wraps a native Stellar asset, making it accessible to other Soroban contracts via the standard token interface.

**ILN usage:** USDC on the ILN protocol is represented as a SAC, allowing the ILN contract to call `transfer()` directly on the token contract to move funds between freelancers, LPs, and the escrow.

---

## Soroban

Stellar's smart contract platform that allows developers to write and deploy WebAssembly (WASM) contracts on the Stellar ledger.

**ILN usage:** All ILN core logic — invoice submission, funding, settlement, and governance — is implemented as Soroban smart contracts deployed to the Stellar network.

---

## Stroop

The smallest unit of XLM (Stellar's native currency), equal to one ten-millionth of one XLM (0.0000001 XLM). Used for precise fee and balance calculations.

**ILN usage:** Transaction fees on the ILN protocol are denominated in stroops; the SDK exposes fee estimates in stroops via the Horizon `fee_estimate` endpoint before submitting contract invocations.

---

## Submitter

The wallet address that signs and broadcasts a transaction to the Stellar network on behalf of a freelancer or payer. May be the same as the freelancer or an automated relay.

**ILN usage:** In the ILN CLI, the submitter is configured via the `--source` flag; in the SDK, it is the wallet passed to the `submitInvoice()` call, which must hold enough XLM to cover the transaction fee.

---

## Trustline

An explicit opt-in relationship between a Stellar account and a non-native asset that allows the account to hold and transact that asset.

**ILN usage:** Before an LP can receive USDC through the ILN protocol, their Stellar account must have an established trustline for the USDC SAC; the ILN frontend prompts LPs to create this trustline during onboarding.

---

*For terms not listed here, refer to the [Stellar Developers Portal](https://developers.stellar.org) or open an issue in the [ILN repository](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network).*

# Glossary

Protocol terminology used across ILN docs, SDKs, contracts, indexer, and notifications. Terms are sorted alphabetically.

> **Cross-referenced with** [`sdk/src/errors.ts`](../sdk/src/errors.ts), [`docs/contracts/`](contracts/),
> and [`docs/indexer-data-model.md`](indexer-data-model.md). When a contract field name and a
> glossary term collide, the **contract field name is canonical** (snake_case for storage,
> `UpperCamelCase` for enum variants). Error codes from the SDK use `UPPER_SNAKE_CASE`.

## Appealed

Invoice state after the payer files an `appeal_default` request following a
default marking. Admin review is pending and LP default refunds are still
locked. Maps to the `Appealed` enum variant in
[`docs/contracts/invoice-contract.md`](contracts/invoice-contract.md). **Terminal
only after the appeal is resolved.**

## Auction Rate

The `discount_rate`-equivalent parameter that varies over time in a **Dutch
auction**. On-chain fields: `auction_start_rate` (initial bps), `auction_min_rate`
(floor bps), `auction_rate_decay_per_hour` (decay in bps/hour), `auction_started_at`.
Built from `submit_invoice_auction(…)` rather than `submit_invoice(…)`.

> **Auction Discount Rate** is the specific `discount_rate` value computed by
> the auction clock at the moment of funding. It is the auction analog of
> **Base Discount Rate** below, but updated continuously between
> `auction_started_at` and the time of `fund_invoice(…)`.

## Base Discount Rate

The base bps `discount_rate` submitted by the freelancer at invoice creation
time, before any reputation-based adjustment or auction decay. This is the
field stored on-chain as `discount_rate: u32` in the `Invoice` struct, and is
also exposed as `base_discount_rate_bps` in the [Reputation Contract](contracts/reputation-contract.md)
when the invoice passes through that hook.

The reputation contract derives an **Effective Discount Rate**
(`effective_discount_rate_bps`) by adding a reputation-tier bonus on top of
the Base Discount Rate and then clamping to a configurable floor.

## Reputation Profile

The struct persisted by the [Reputation Contract](contracts/reputation-contract.md) for
each addressed principal (`ReputationProfile`). Fields: `address`, `payer_score`,
`invoices_submitted`, `invoices_paid`, `invoices_defaulted`.

**Reputation Score** is the integer score (`payer_score: u32`) inside a
`ReputationProfile` — a number between 0 and 100+ that summarizes observed
reliability. The two terms refer to the same data (`score` is to `profile`
what `balance` is to `account`), but `Reputation Score` is what integrators
see and `ReputationProfile` is the on-chain struct name.

See: [Reputation Contract](contracts/reputation-contract.md).

## Basis Points (bps)

A unit equal to one-hundredth of one percent, so 100 bps equals 1%. ILN uses bps for discount rates, fees, and yield calculations because integer math is safer in contracts and SDKs.

See: [Protocol Economics](protocol-economics.md)

## Circuit Breaker

A safety control that pauses or limits sensitive protocol actions during an incident. In ILN, circuit breakers are relevant to contract funding, settlement, upgrades, indexing, and notification delivery.

See: [Security](security.md)

## Discount Rate

The percentage discount a submitter accepts in exchange for receiving liquidity
before the payer settles the invoice, expressed in **basis points (bps)**. On-chain
field: `discount_rate: u32` in the `Invoice` struct (see
[`docs/contracts/invoice-contract.md`](contracts/invoice-contract.md)). A 300 bps
discount means the liquidity provider funds 97% of face value and earns the 3%
spread at settlement.

> **Canonical pairing:** the contract field is `discount_rate`. The indexer
> stores the same value in `discount_rate` (see [`indexer-data-model.md`](indexer-data-model.md)).
> The SDK exposes it as `discountRate` (camelCase) only at the language boundary;
> every persisted artifact and contract ABI uses lowercase `discount_rate`.

**See also:** [Effective Yield](#effective-yield), [Auction Rate](#auction-rate).

See: [Protocol Economics](protocol-economics.md)

## Effective Yield

The annualized return an LP earns after a `Paid` settlement. Numerically equal
to the discount rate when settlement is on time: ILN examples commonly
calculate this as `(discount_bps / 10000) * (365 / days_to_settlement)`. **"Discount
rate" and "effective yield" name the same number from two perspectives**: the
freelancer sees it as a discount, the LP sees it as yield. The reputation
contract additionally defines `effective_discount_rate_bps`, which adjusts a
`base_discount_rate_bps` upward for high-reputation payers; see
[`docs/contracts/reputation-contract.md`](contracts/reputation-contract.md).

## HMAC

Hash-based Message Authentication Code, a signature-like digest used to verify
that a webhook payload came from the expected sender and was not modified. ILN
notification receivers should reject webhook requests with missing or invalid
HMAC values.

See: [Notifications](notifications.md)

## Horizon

Stellar's REST API service for account data, transactions, ledgers, assets, and
network metadata. ILN tooling may use Horizon alongside Soroban RPC for account
and network state.

See: [Stellar Primer](stellar-primer.md)

## Invoice Factoring

A financing model where an invoice holder sells or discounts an unpaid invoice
to receive cash before the payer settles. ILN implements a DeFi version where
liquidity providers fund invoices on-chain and receive settlement value later.

See: [Protocol Overview](protocol-overview.md)

## Invoice Status

The finite state machine an invoice traverses. Defined as the soroban `InvoiceStatus`
enum and used identically by the contract, the indexer, and the SDK. Sorted
alphabetically below:

| Variant | Meaning | Terminal? |
|---------|---------|-----------|
| `Appealed` | Payer appealed a default | No |
| `Cancelled` | Submitter cancelled a `Pending` invoice | **Yes** |
| `Defaulted` | Past due with no payment | **Yes** |
| `Disputed` | Payer disputed pre-settlement | No |
| `Expired` | Never funded and due date passed | **Yes** |
| `Funded` | Fully funded, awaiting settlement | No |
| `Paid` | Settled on time | **Yes** |
| `PartiallyFunded` | One or more LPs have contributed but invoice is not fully funded | No |
| `Pending` | Submitted, awaiting LP funding | No |

See: [`docs/contracts/invoice-contract.md`](contracts/invoice-contract.md),
[`docs/indexer-data-model.md`](indexer-data-model.md).

## Ledger

An ordered batch of Stellar transactions accepted by network consensus. ILN
indexers track ledger ranges to reconstruct invoice events and settlement state.

See: [Indexer Data Model](indexer-data-model.md)

## Liquidity Provider (LP)

A participant who funds invoices by providing liquidity at the discounted
amount. The LP expects to receive the invoice face value at settlement and
earns the difference as yield.

See: [LP Funding Tutorial](tutorials/lp-funding.md)

## One-Click Unsubscribe

A user-facing flow that lets a notification recipient disable every
notification channel for a Stellar address in a single request, with the
request taking effect immediately and no follow-up confirmation step. In the
ILN notifications service this maps to
`POST /preferences/:address/unsubscribe` and the tokenized variant
`POST /preferences/unsubscribe/token/:token`. The tokenized URL is what is
embedded in every outbound email's footer link and is signed with
HMAC-SHA256 over `(address, nonce)` so it cannot be forged or replayed.
See: [Privacy Policy](privacy.md).

## Payer

The customer or counterparty responsible for settling the invoice. ILN uses
payer identity and behavior as part of invoice authorization, settlement, and
reputation flows.

See: [Submit Your First Invoice](tutorials/first-invoice.md)

## Quorum

The minimum approval threshold required for a governance or administrative
decision. ILN uses quorum concepts for maintainer sign-off, governance changes,
and mainnet readiness decisions.

See: [Governance Guide](governance-guide.md)

## Reputation Score

A score that represents observed reliability for submitters, payers, or related
protocol actors. ILN reputation can help liquidity providers assess invoice
risk and discount expectations.

See: [Reputation Contract](contracts/reputation-contract.md)

## Settlement

The point where the payer's obligation is marked as paid and the protocol
releases or accounts for final value owed to the liquidity provider. Settlement
changes invoice state and is a core event for indexer and notification
consumers.

See: [Invoice Contract](contracts/invoice-contract.md)

## SDK Error Code

A `UPPER_SNAKE_CASE` string `code` exposed on every class in
[`sdk/src/errors.ts`](../sdk/src/errors.ts) (e.g. `INVALID_DISCOUNT_RATE`,
`PAYER_REPUTATION_TOO_LOW`, `INSUFFICIENT_BALANCE`). Each class has a stable
URL fragment `#<lower_snake>` in [`docs/errors.md`](errors.md). Display strings
in markdown UI use the `snake_case` form (e.g. `invalid_discount_rate`) while
the SDK emits the `UPPER_SNAKE_CASE` form at runtime.

## Soroban

Stellar's smart contract platform, where contracts are compiled to WebAssembly
and run with Stellar ledger integration. ILN contract logic for invoices,
reputation, and governance is designed for Soroban.

See: [Stellar Primer](stellar-primer.md)

## Stellar Asset Contract (SAC)

A Soroban contract interface that represents Stellar assets for smart contract
use. ILN uses SAC-compatible assets such as USDC-style stablecoins for funding
and settlement flows.

See: [Multi-Token Support](tokens/multi-token-support.md)

## Submitter

The account or service that submits an invoice transaction to the network. The
submitter may be the invoice owner directly or an authorized integration using
the SDK or CLI.

See: [SDK Quickstart](sdk-quickstart.md)

## Timelock

A delay between approval and execution of a sensitive action, such as an
upgrade or parameter change. Timelocks give users and maintainers time to
inspect pending governance changes before they take effect.

See: [Governance Guide](governance-guide.md)

## Trustline

A Stellar account's explicit opt-in to hold a non-native asset. Users must have
the correct trustline before receiving or transacting certain Stellar assets
outside pure Soroban contract custody.

See: [Stellar Primer](stellar-primer.md)

## XDR

External Data Representation, the binary serialization format used by Stellar
for transactions, operations, ledger entries, and contract data. ILN SDK and
CLI code must encode and decode XDR exactly to avoid signing or submission bugs.

See: [`packages/sdk/src/xdr.ts`](../packages/sdk/src/xdr.ts)

## Yield

The return earned by a liquidity provider for funding an invoice. In ILN, yield
usually comes from the discount between the funded amount and the invoice face
value paid at settlement. Numerically equal to the [Discount Rate](#discount-rate)
expressed in basis points.

See: [Protocol Economics](protocol-economics.md)

## HMAC

Hash-based Message Authentication Code, a signature-like digest used to verify that a webhook payload came from the expected sender and was not modified. ILN notification receivers should reject webhook requests with missing or invalid HMAC values.

See: [Notifications](notifications.md)

## Horizon

Stellar's REST API service for account data, transactions, ledgers, assets, and network metadata. ILN tooling may use Horizon alongside Soroban RPC for account and network state.

See: [Stellar Primer](stellar-primer.md)

## Invoice Factoring

A financing model where an invoice holder sells or discounts an unpaid invoice to receive cash before the payer settles. ILN implements a DeFi version where liquidity providers fund invoices on-chain and receive settlement value later.

See: [Protocol Overview](protocol-overview.md)

## Ledger

An ordered batch of Stellar transactions accepted by network consensus. ILN indexers track ledger ranges to reconstruct invoice events and settlement state.

See: [Indexer Data Model](indexer-data-model.md)

## Liquidity Provider (LP)

A participant who funds invoices by providing liquidity at the discounted amount. The LP expects to receive the invoice face value at settlement and earns the difference as yield.

See: [LP Funding Tutorial](tutorials/lp-funding.md)

## Payer

The customer or counterparty responsible for settling the invoice. ILN uses payer identity and behavior as part of invoice authorization, settlement, and reputation flows.

See: [Submit Your First Invoice](tutorials/first-invoice.md)

## Quorum

The minimum approval threshold required for a governance or administrative decision. ILN uses quorum concepts for maintainer sign-off, governance changes, and mainnet readiness decisions.

See: [Governance Guide](governance-guide.md)

## Reputation Score

A score that represents observed reliability for submitters, payers, or related protocol actors. ILN reputation can help liquidity providers assess invoice risk and discount expectations.

See: [Reputation Contract](contracts/reputation-contract.md)

## Settlement

The point where the payer's obligation is marked as paid and the protocol releases or accounts for final value owed to the liquidity provider. Settlement changes invoice state and is a core event for indexer and notification consumers.

See: [Invoice Contract](contracts/invoice-contract.md)

## Soroban

Stellar's smart contract platform, where contracts are compiled to WebAssembly and run with Stellar ledger integration. ILN contract logic for invoices, reputation, and governance is designed for Soroban.

See: [Stellar Primer](stellar-primer.md)

## Stellar Asset Contract (SAC)

A Soroban contract interface that represents Stellar assets for smart contract use. ILN uses SAC-compatible assets such as USDC-style stablecoins for funding and settlement flows.

See: [Multi-Token Support](tokens/multi-token-support.md)

## Submitter

The account or service that submits an invoice transaction to the network. The submitter may be the invoice owner directly or an authorized integration using the SDK or CLI.

See: [SDK Quickstart](sdk-quickstart.md)

## Timelock

A delay between approval and execution of a sensitive action, such as an upgrade or parameter change. Timelocks give users and maintainers time to inspect pending governance changes before they take effect.

See: [Governance Guide](governance-guide.md)

## Trustline

A Stellar account's explicit opt-in to hold a non-native asset. Users must have the correct trustline before receiving or transacting certain Stellar assets outside pure Soroban contract custody.

See: [Stellar Primer](stellar-primer.md)

## XDR

External Data Representation, the binary serialization format used by Stellar for transactions, operations, ledger entries, and contract data. ILN SDK and CLI code must encode and decode XDR exactly to avoid signing or submission bugs.

See: [`packages/sdk/src/xdr.ts`](../packages/sdk/src/xdr.ts)

## Yield

The return earned by a liquidity provider for funding an invoice. In ILN, yield usually comes from the discount between the funded amount and the invoice face value paid at settlement.

See: [Protocol Economics](protocol-economics.md)

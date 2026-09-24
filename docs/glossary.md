# Glossary

Protocol terminology used across ILN docs, SDKs, contracts, indexer, oracle
service, and notifications. Terms are sorted alphabetically.

> **Cross-referenced with** [`sdk/src/errors.ts`](../sdk/src/errors.ts), [`docs/contracts/`](contracts/),
> [`docs/indexer-data-model.md`](indexer-data-model.md), [`docs/oracle-service.md`](oracle-service.md),
> and [`docs/notifications.md`](notifications.md). When a contract field name and a
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

See also: [Dutch Auction](#dutch-auction).

## Base Discount Rate

The base bps `discount_rate` submitted by the freelancer at invoice creation
time, before any reputation-based adjustment or auction decay. This is the
field stored on-chain as `discount_rate: u32` in the `Invoice` struct, and is
also exposed as `base_discount_rate_bps` in the [Reputation Contract](contracts/reputation-contract.md)
when the invoice passes through that hook.

The reputation contract derives an **Effective Discount Rate**
(`effective_discount_rate_bps`) by adding a reputation-tier bonus on top of
the Base Discount Rate and then clamping to a configurable floor.

## Basis Points (bps)

A unit equal to one-hundredth of one percent, so 100 bps equals 1%. ILN uses bps
for discount rates, fees, and yield calculations because integer math is safer in
contracts and SDKs.

See: [Protocol Economics](protocol-economics.md)

## Circuit Breaker

A safety control that pauses or limits sensitive protocol actions during an
incident. In ILN, circuit breakers are relevant to contract funding, settlement,
upgrades, indexing, and notification delivery.

See: [Security](security.md)

## Claim Default

The action, taken by a funder after an invoice is past due and its
[grace period](#grace-period) has elapsed, that marks the invoice `Defaulted`
and releases the LP's default remedy. Exposed as `claimDefault({ funder,
invoiceId })` in the SDK and `iln claim`/`iln pay` flows in the CLI; the payer
may respond with `appeal_default` (see [Appealed](#appealed)).

See: [`docs/contracts/invoice-contract.md`](contracts/invoice-contract.md)

## Default

Terminal invoice outcome where the payer never settled and a funder has called
[claim default](#claim-default). Distinct from **[Expired](#invoice-status)**
(never funded, due date passed). The historical default rate for a payer feeds
the [oracle service](#oracle-service) [trust score](#trust-score).

## Digest Batching

The notifications option that buffers a user's invoice events and delivers one
aggregated email on a daily or weekly cadence instead of one message per event
(`notifications/src/digest.ts`, `DigestScheduler`). Preview the pending digest
for an address at `GET /digest/preview/:address`.

See: [Notifications](notifications.md)

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

**See also:** [Effective Yield](#effective-yield), [Auction Rate](#auction-rate), [Yield](#yield).

See: [Protocol Economics](protocol-economics.md)

## Dispute

Invoice state (`Disputed`) after the payer raises a pre-settlement objection.
Non-terminal: it resolves back toward settlement or into a default/appeal path.
Contrast with [Appealed](#appealed), which follows a *default marking* rather
than preceding settlement.

See: [`docs/contracts/invoice-contract.md`](contracts/invoice-contract.md)

## Dutch Auction

An invoice-funding mode in which the offered [discount rate](#discount-rate)
starts high and decays toward a floor over time, so the first LP willing to fund
sets the clearing rate. Created with `submit_invoice_auction(…)`; the live rate
is the [Auction Rate](#auction-rate). Parameters: `auction_start_rate`,
`auction_min_rate`, `auction_rate_decay_per_hour`, `auction_started_at`.

## Effective Yield

The annualized return an LP earns after a `Paid` settlement. Numerically equal
to the discount rate when settlement is on time: ILN examples commonly
calculate this as `(discount_bps / 10000) * (365 / days_to_settlement)`. **"Discount
rate" and "effective yield" name the same number from two perspectives**: the
freelancer sees it as a discount, the LP sees it as yield. The reputation
contract additionally defines `effective_discount_rate_bps`, which adjusts a
`base_discount_rate_bps` upward for high-reputation payers; see
[`docs/contracts/reputation-contract.md`](contracts/reputation-contract.md).

## Federation

The Stellar SEP-2 mechanism for resolving a human-readable `name*domain`
address to a Stellar account ID. `@iln/sdk` ships a `federation` helper
(`sdk/src/federation.ts`) with a default resolver at `federation.iln.finance`.

See: [SEP-10](#sep-10), [Stellar Primer](stellar-primer.md)

## Fraud Signal

A discrete risk pattern the [oracle service](#oracle-service) detects in a
payer's indexed history: multiple recent similar-amount invoices, rapid
succession (3+ in 24h), concentrated recent defaults (2+ in 30d), or clustered
`updated_at` timestamps. Fraud signals are **blocking** — a passing
[KYB](#kyb-know-your-business) result cannot clear them — and each one reduces
the [trust score](#trust-score).

See: [Oracle Service](oracle-service.md)

## Friendbot

The Stellar testnet faucet (`https://friendbot.stellar.org`, and the local
Quickstart node's `/friendbot` endpoint) that funds a new account with test XLM.
Used throughout local development and the SDK/CLI test suites. Not available on
mainnet.

See: [Local Development](local-development.md)

## Governance Proposal

An on-chain proposal to change a protocol parameter or execute a privileged
action, subject to a [quorum](#quorum) of votes and a [timelock](#timelock)
before execution. The SDK exposes `createProposal`, `castVote`,
`delegateVotes`/`undelegateVotes`, `executeProposal`, and `vetoProposal`, plus
reads (`getProposal`, `listProposals`, `getExecutionDelay`).

See: [Governance Guide](governance-guide.md)

## Grace Period

The interval after an invoice's `due_date` during which the payer can still
settle without a default being claimable. Exposed as the optional
`gracePeriodSeconds` field of `ProtocolConfig`. Only once it elapses can a
funder [claim default](#claim-default).

See: [`docs/contracts/invoice-contract.md`](contracts/invoice-contract.md)

## HMAC

Hash-based Message Authentication Code, a signature-like digest used to verify
that a webhook payload came from the expected sender and was not modified. ILN
webhook deliveries carry `X-ILN-Signature: sha256=<hex>`, computed with
HMAC-SHA256 over the raw body keyed by the **per-subscription** `webhook_secret`.
Receivers should reject requests with a missing or mismatched signature.

See: [Notifications](notifications.md)

## Horizon

Stellar's REST API service for account data, transactions, ledgers, assets, and
network metadata. ILN tooling may use Horizon alongside Soroban RPC for account
and network state.

See: [Stellar Primer](stellar-primer.md)

## Insurance Pool

An optional coverage pool an LP can enroll in to backstop losses from defaulted
invoices, in exchange for a premium. Modeled by `@iln/sdk`'s
`InsurancePoolClient` and the `LPCoverage` / `InsuranceClaim` /
`ClaimStatus` (`Pending` | `Approved` | `Rejected`) types.

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

## KYB (Know Your Business)

Legal verification of a business entity's identity — corporate registration,
beneficial ownership, sanctions screening. The [oracle service](#oracle-service)
does **not** perform KYB itself; it exposes a pluggable
`ExternalVerificationProvider` / `VerificationProvider` port for a third-party
KYB vendor. A KYB result moves *confidence*, not the verdict: `verified` adds a
bonus, `unverified` caps confidence, and `unknown` (provider absent, timed out,
or no record) changes nothing — deliberately distinct from `unverified`.

See: [Oracle Service](oracle-service.md)

## Ledger

An ordered batch of Stellar transactions accepted by network consensus. ILN
indexers track ledger ranges to reconstruct invoice events and settlement state.

See: [Indexer Data Model](indexer-data-model.md)

## Liquidity Provider (LP)

A participant who funds invoices by providing liquidity at the discounted
amount. The LP expects to receive the invoice face value at settlement and
earns the difference as yield.

See: [LP Funding Tutorial](tutorials/lp-funding.md)

## Notification Channel

A delivery transport for notifications. `SubscriptionChannel` /
`MultiChannelDelivery` implement four lowercase names — `email`, `webhook`,
`sms`, `websocket` — but only `email`, `webhook`, and `sms` are persisted
subscription preferences (`ALLOWED_CHANNELS`). `@iln/sdk`'s `NotificationsClient`
supports `email` and `webhook`.

See: [Notifications](notifications.md)

## Notification Trigger

The invoice lifecycle event that causes a notification to be sent.
`ALLOWED_TRIGGERS` in the service: `invoice_funded`, `invoice_paid`,
`invoice_defaulted`, `invoice_due_soon`, `invoice_overdue`. The SDK enum
`NotificationTrigger` covers the first four.

See: [Notifications](notifications.md)

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

## Oracle Service

The off-chain HTTP service (`oracle-service/`, `@iln/oracle-service`) that
answers `fund_invoice()`'s `require_oracle_verification: true` path. It composes
two independent signals — a behavioural **[fraud heuristic](#fraud-signal)** over
the payer's indexed history and an optional external **[KYB](#kyb-know-your-business)**
lookup — into one verdict with a versioned `composition` object. Fraud signals
are blocking; staleness outranks fraud (`rejected-stale-data`). It cannot move
funds or sign anything — its only output is a pass/fail the caller uses as a
funding gate. See the [SDK Trust Model](sdk-trust-model.md) for its place in the
trust chain.

See: [Oracle Service](oracle-service.md)

## Payer

The customer or counterparty responsible for settling the invoice. ILN uses
payer identity and behavior as part of invoice authorization, settlement, and
reputation flows.

See: [Submit Your First Invoice](tutorials/first-invoice.md)

## Protocol Fee

The share of an invoice's spread retained by the protocol, expressed in bps as
`protocolFeeBps` in `ProtocolConfig` (read via `sdk.getProtocolConfig()`).
Separate from the LP's [yield](#yield).

See: [Protocol Economics](protocol-economics.md)

## Quorum

The minimum approval threshold required for a governance or administrative
decision. ILN uses quorum concepts for maintainer sign-off, governance changes,
and mainnet readiness decisions. The on-chain governance default is 10% of total
voting supply.

See: [Governance Guide](governance-guide.md)

## Referral Code

An optional `BytesN<32>` value (`referral_code`) attached to `submit_invoice(…)`
/ `submit_invoice_auction(…)` for attribution tracking. Does not affect
authorization or economics.

See: [`docs/contracts/invoice-contract.md`](contracts/invoice-contract.md)

## Reputation Decay

The gradual reduction of a `payer_score` over time based on ledger inactivity
(`last_activity_ledger`), governed by `decay_rate_bps` / `decayRateBps` in the
protocol config and emitted on-chain as `PayerReputationDecayed`. Because decay
depends on the *current* ledger, indexers cannot compute it from stored events —
always read live reputation via `get_reputation(address)`.

See: [Indexer Data Model](indexer-data-model.md#reputation-computation),
[`docs/contracts/reputation-contract.md`](contracts/reputation-contract.md)

## Reputation Profile

The struct persisted by the [Reputation Contract](contracts/reputation-contract.md) for
each addressed principal (`ReputationProfile`). Fields: `address`, `payer_score`,
`invoices_submitted`, `invoices_paid`, `invoices_defaulted`.

**Reputation Score** is the integer score (`payer_score: u32`) inside a
`ReputationProfile` — a number between 0 and 100+ that summarizes observed
reliability. The two terms refer to the same data (`score` is to `profile`
what `balance` is to `account`), but `Reputation Score` is what integrators
see and `ReputationProfile` is the on-chain struct name.

See: [Reputation Contract](contracts/reputation-contract.md), [Reputation Decay](#reputation-decay).

## Reputation Score

The integer reliability score for a payer (`payer_score: u32`, range 0–100+),
surfaced by `sdk.getReputation(address)` as a JS `number`. Subject to
[reputation decay](#reputation-decay). See [Reputation Profile](#reputation-profile)
for the containing struct.

See: [Reputation Contract](contracts/reputation-contract.md)

## SDK Error Code

A `UPPER_SNAKE_CASE` string `code` exposed on every class in
[`sdk/src/errors.ts`](../sdk/src/errors.ts) (e.g. `INVALID_DISCOUNT_RATE`,
`PAYER_REPUTATION_TOO_LOW`, `INSUFFICIENT_BALANCE`). Each class has a stable
URL fragment `#<lower_snake>` in [`docs/errors.md`](errors.md). Display strings
in markdown UI use the `snake_case` form (e.g. `invalid_discount_rate`) while
the SDK emits the `UPPER_SNAKE_CASE` form at runtime.

## SEP-10

The Stellar standard for **web authentication** — a challenge-response handshake
that proves control of a Stellar account to a service without exposing the
secret key. Relevant to any ILN service that needs authenticated,
account-scoped access.

See: [Stellar Primer](stellar-primer.md)

## SEP-24

The Stellar standard for **hosted (interactive) deposit and withdrawal** between
a Stellar asset and off-chain rails, driven by an anchor-hosted web flow. ILN's
on-chain invoice flows do not call SEP-24 directly, but wallets and fiat
on/off-ramps that users fund their accounts through commonly do.

See: [Stellar Primer](stellar-primer.md)

## SEP-41

The **Soroban token interface** — the Stellar equivalent of ERC-20. Classic
assets (USDC, EURC, XLM) are exposed to Soroban contracts through a
[Stellar Asset Contract (SAC)](#stellar-asset-contract-sac) that implements
SEP-41. ILN funding and settlement move SEP-41 token balances.

See: [Stellar Primer](stellar-primer.md#soroban-tokens-sep-41)

## Settlement

The point where the payer's obligation is marked as paid and the protocol
releases or accounts for final value owed to the liquidity provider. Settlement
changes invoice state and is a core event for indexer and notification
consumers.

See: [Invoice Contract](contracts/invoice-contract.md)

## SLSA

Supply-chain Levels for Software Artifacts — a framework for build provenance
and integrity. ILN publishes npm packages with SLSA Level 3 provenance;
integrators verify it with `npm audit signatures @iln/sdk`.

See: [Security Guide](security-guide.md), [Release Process](release-process.md#package-provenance-verification-issue-878)

## Soroban

Stellar's smart contract platform, where contracts are compiled to WebAssembly
and run with Stellar ledger integration. ILN contract logic for invoices,
reputation, and governance is designed for Soroban.

See: [Stellar Primer](stellar-primer.md)

## Standalone Network

A self-contained local Stellar network (no connection to testnet or mainnet)
run by the Stellar Quickstart Docker image for local development. Its network
passphrase is `Standalone Network ; February 2017` (the SDK also exports a
`NETWORKS.STANDALONE` constant for a later variant). Not the same as testnet.

See: [Local Development](local-development.md)

## Stellar Asset Contract (SAC)

A Soroban contract interface that represents Stellar assets for smart contract
use, implementing the [SEP-41](#sep-41) token interface. ILN uses SAC-compatible
assets such as USDC-style stablecoins for funding and settlement flows.

See: [Multi-Token Support](tokens/multi-token-support.md)

## Stroop

The smallest unit of a Stellar asset: 1 unit = 10,000,000 stroops (10⁻⁷). The
indexer and contract report `amount`, `totalVolume`, and `totalYield` in
stroops as strings; the SDK uses `bigint`. The minimum network fee is 100
stroops per operation.

See: [Stellar Primer](stellar-primer.md)

## Submitter

The account or service that submits an invoice transaction to the network. The
submitter may be the invoice owner directly or an authorized integration using
the SDK or CLI.

See: [SDK Quickstart](sdk-quickstart.md)

## Timelock

A delay between approval and execution of a sensitive action, such as an
upgrade or parameter change. Timelocks give users and maintainers time to
inspect pending governance changes before they take effect. Read the current
delay with `sdk.getExecutionDelay()`.

See: [Governance Guide](governance-guide.md)

## Trust Score

The oracle service's `0–100` composite assessment of a payer, weighting on-chain
reputation (~38%), historical success rate (~33%), amount fit (~17%), and
settlement-variance fit (~12%), minus penalties for defaults and
[fraud signals](#fraud-signal). A verdict is `isVerified: true` only when
`trustScore ≥ 70`, `confidence ≥ 0.55`, no fraud signals fired, and the source
data is fresh.

See: [Oracle Service](oracle-service.md)

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

# ILN Protocol Overview

## The Invoice Liquidity Problem

Freelancers, creators, and small businesses routinely wait 30–90 days for invoices to be paid. That gap between delivering work and receiving payment creates real cash-flow pressure — forcing people to take on debt, turn down new work, or absorb late fees they didn't earn.

Traditional invoice factoring solves this by letting a third party advance cash against an outstanding invoice, but it comes with significant friction: bank relationships, credit checks, minimum volumes, and fees that are opaque until you're already locked in.

ILN takes the same economic model — advance liquidity against a future payment in exchange for a yield — and runs it on-chain via a Soroban smart contract on Stellar. The result is a permissionless, transparent, and near-instant market for invoice liquidity.

---

## ILN's Solution: Submit → Fund → Settle

Every invoice in ILN moves through a three-step lifecycle:

```
submit_invoice()        fund_invoice()          mark_paid()
      │                      │                      │
  Freelancer             Liquidity               Payer
  creates the            Provider                settles the
  invoice                funds it                invoice
      │                      │                      │
      ▼                      ▼                      ▼
  [Pending]  ──────────►  [Funded]  ──────────►  [Paid]
                                                     │
                                          LP receives
                                          principal + yield
```

**Submit** — A freelancer calls `submit_invoice()` with the invoice amount, the payer's address, a due date, and a discount rate. The contract creates an invoice record in the `Pending` state.

**Fund** — A liquidity provider calls `fund_invoice()`. The contract transfers USDC (or any supported token) from the LP's account: the freelancer immediately receives `amount − discount`, and the discount is held in escrow. The invoice moves to `Funded`.

**Settle** — The payer calls `mark_paid()` before the due date. The contract releases `amount + discount` to the LP. The LP's realized yield is the discount spread. The invoice is now `Paid`.

If the payer does not settle before the due date, the LP can call `claim_default()`. The LP recovers the escrowed discount but does not recover principal — the invoice is marked `Defaulted`.

---

## The Three Roles

### Freelancer

The party who performed work and issued the invoice. The freelancer:

- Calls `submit_invoice()` to register the invoice on-chain
- Specifies the discount rate they are willing to accept
- Receives funds immediately once an LP funds the invoice (`amount − discount_amount`)
- Has no further obligation once funded — the invoice relationship is between the LP and payer

### Payer

The business or individual who owes payment for the delivered work. The payer:

- Is registered as the expected settler when the invoice is submitted
- Calls `mark_paid()` to settle the invoice by the due date
- Transfers the full invoice amount to the contract on settlement
- Builds on-chain reputation with each timely settlement (+1 per paid invoice)
- Loses reputation for defaults (−5 per defaulted invoice, floored at 0)

### Liquidity Provider (LP)

A DeFi participant who funds invoices in exchange for yield. The LP:

- Browses `Pending` invoices and selects those with acceptable risk/return profiles
- Calls `fund_invoice()`, transferring the full invoice amount minus the escrowed discount
- Waits for the payer to settle — earning the discount spread as yield on settlement
- Can call `claim_default()` after the due date if the payer has not settled, recovering the escrowed discount

---

## Discount Rates and Yield

The discount rate is set by the freelancer at submission and is expressed in **basis points** (bps), where 100 bps = 1%.

```
discount_amount   = floor(amount × discount_rate / 10_000)
freelancer payout = amount − discount_amount
LP realized yield = discount_amount  (when the invoice is Paid)
```

For example, a 3.00% discount rate (300 bps) on a 1,000 USDC invoice:

```
discount_amount   = floor(1,000 × 300 / 10,000) = 30 USDC
freelancer payout = 1,000 − 30 = 970 USDC       (paid immediately on funding)
LP realized yield = 30 USDC                      (paid on settlement)
```

Amounts on-chain are denominated in token base units — `10,000,000` units equals 1 USDC for the supported stablecoin assets.

On default, the LP recovers the escrowed `discount_amount` only. Principal loss is the LP's risk, which is priced into the discount rate they are willing to accept.

---

## The Reputation System

ILN tracks a per-payer reputation score on-chain, updated at settlement:

| Event | Score change |
|---|---|
| `mark_paid` (on-time settlement) | +1 |
| `claim_default` (missed due date) | −5 (floored at 0) |

The reputation score is publicly readable from the contract. LPs can use it as a signal when evaluating whether to fund invoices for a given payer. A payer with a high score has a track record of settling on time; a payer with a score near zero has a history of defaults.

The current analytics API surfaces aggregate default rates per payer but does not yet expose payer score history directly. This is on the protocol roadmap.

---

## What ILN Is Not

- **Not a lending protocol.** LPs buy the right to receive a future payment from a payer; they are not lending to the freelancer.
- **Not a credit bureau.** Reputation scores reflect on-chain settlement history only. Off-chain payer identity, credit reports, and KYC are out of scope.
- **Not escrow.** The freelancer receives funds as soon as an LP calls `fund_invoice()`. There is no hold waiting for payer confirmation.
- **Not governed by a single entity.** Protocol parameters are managed by an on-chain governance contract (`ILN-Governance`). See [governance.md](governance.md) for details.

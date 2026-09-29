# RFC 0001 — Dutch Auction Funding

- **Status:** Accepted
- **Author(s):** [@Invoice-Liquidity-Network](https://github.com/Invoice-Liquidity-Network)
- **Created:** 2026-06-23
- **PR:** (pending)
- **Tracking issues:** #6, #7, #8, #10

---

## Summary

Replace the current fixed-discount funding model with a Dutch auction mechanism, where the discount rate offered to liquidity providers rises incrementally over time until an LP funds the invoice or the invoice expires.

---

## Motivation

Under the current model, a freelancer sets a fixed discount rate when submitting an invoice. If the rate is too low relative to LP appetite, the invoice sits unfunded indefinitely. The freelancer has no recourse except to cancel and resubmit at a higher rate, which costs fees and creates a poor experience.

A Dutch auction solves this by starting at the freelancer's minimum acceptable discount and automatically increasing the rate on a defined schedule. The first LP to call `fund_invoice()` locks in the current rate. This means:

- invoices clear at the market-clearing rate rather than a guessed fixed rate
- freelancers avoid manual resubmission loops
- LPs are incentivised to fund quickly when yield is attractive

---

## Detailed Design

### New invoice fields

```rust
pub struct Invoice {
    // existing fields ...
    pub start_discount_bps: u32,   // starting discount rate in basis points
    pub max_discount_bps: u32,     // ceiling the auction will not exceed
    pub auction_step_bps: u32,     // basis points added per step_interval
    pub step_interval_seconds: u64,// how often the rate increments
    pub submitted_at: u64,         // ledger timestamp of submission
}
```

### Rate calculation

The effective discount at any moment is:

```
elapsed_steps = (now - submitted_at) / step_interval_seconds
current_discount = min(
    start_discount_bps + elapsed_steps * auction_step_bps,
    max_discount_bps
)
```

This is computed inside `fund_invoice()`. No scheduled jobs or oracles are required — the contract is purely reactive.

### Contract changes

- `submit_invoice()` gains four new parameters: `start_discount_bps`, `max_discount_bps`, `auction_step_bps`, `step_interval_seconds`. The existing `discount_bps` parameter is removed.
- `fund_invoice()` reads the current auction rate and deducts it from the freelancer's payout. The LP receives the full invoice amount when the payer settles.
- `get_invoice()` returns the computed `current_discount_bps` alongside the stored fields so the frontend can display a live rate.

### SDK changes

- `submitInvoice()` accepts `auctionParams: { startBps, maxBps, stepBps, intervalSeconds }` instead of `discountBps`.
- A new helper `getCurrentDiscount(invoiceId)` calls `get_invoice()` and returns the live rate.

### CLI changes

```bash
iln submit --payer G... --amount 100 --due 2025-12-31 \
  --start-rate 50 --max-rate 500 --step 10 --interval 3600
```

### Migration

Invoices submitted before this change used the fixed-discount model. They are not affected — the contract stores both models and dispatches on a flag set at submission time. After a deprecation period (suggested: one full testnet cycle), the fixed-discount path can be removed in a follow-up RFC.

### Security considerations

- `max_discount_bps` must be validated at submission to be ≤ some protocol-level ceiling (suggested: 2000 bps / 20%) to prevent griefing.
- `step_interval_seconds` must be ≥ one ledger close time (~5 s) to prevent zero-division.
- The rate calculation uses only on-ledger timestamps, so it is deterministic and manipulation-resistant.

---

## Drawbacks

- More complex submission UX. Freelancers must choose four parameters instead of one. Good defaults will be critical.
- Adds four fields to the `Invoice` struct, increasing storage cost per invoice.
- The migration shim for existing invoices adds contract complexity that must eventually be cleaned up.

---

## Alternatives

**Fixed discount with a retry helper in the SDK** — the SDK could automatically resubmit at a higher rate if an invoice is unfunded after N hours. Rejected because it still requires on-chain cancel/resubmit transactions and gives a worse UX than a native mechanism.

**Off-chain matching engine** — match freelancers and LPs off-chain and settle on-chain. Rejected because it reintroduces a trusted intermediary, which contradicts ILN's permissionless design goal.

**Reverse auction (LP bids down)** — LPs compete by offering lower rates. Rejected for this RFC because it requires multiple LPs to be present simultaneously, which is unlikely at current liquidity levels. Worth revisiting when the LP base grows.

---

## Unresolved Questions

1. What should the default values for `step_interval_seconds` and `auction_step_bps` be in the SDK to guide freelancers toward reasonable behaviour?
2. Should the protocol enforce a minimum `start_discount_bps` floor to prevent invoices that can never attract LPs?
3. What is the right deprecation timeline for the legacy fixed-discount path?

---

## Implementation notes

*(Fill in during or after implementation)*

- Tracking issues: #6, #7, #8, #10
- Implementation PR(s): —
- Merged: —

---

## Addendum — Thin-Liquidity and Low-Participation Scenarios

**Analysis date:** 2026-09-29
**Scope:** RFC mechanism as written; this is not evidence that a deployed contract uses these parameters.

### Model and outcomes

The RFC defines the rate as a monotonically increasing discount, capped at `max_discount_bps`; the first LP to fund locks in the then-current rate. It does not specify a minimum amount of competing LP liquidity or a clearing-price auction among multiple LPs. To make the effect concrete, assume a 100-unit face-value invoice with `start_discount_bps = 300`, `auction_step_bps = 100`, `step_interval_seconds = 86,400`, and `max_discount_bps = 2,000`. The table assumes one LP funds the full invoice as soon as they arrive and excludes fees.

| LP arrival / participation case | Elapsed time | Discount | Borrower receives per 100 face | Result |
|---|---:|---:|---:|---|
| Immediate, one LP available | 0 days | 300 bps (3%) | 97 | Clears immediately; no competitive price discovery |
| Low participation, LP arrives after one step | 1 day | 400 bps (4%) | 96 | Clears at a worse borrower price than at submission |
| Thin liquidity, first LP arrives after one week | 7 days | 1,000 bps (10%) | 90 | One LP can fund the full amount at the accrued rate |
| Severe scarcity, first LP arrives at the cap | 17 days | 2,000 bps (20%) | 80 | Clears at the maximum discount; additional waiting cannot raise the rate |
| No LP before expiry | At/after expiry | Capped or expired | No funding proceeds | No clearing occurs; invoice remains unfunded or expires per contract rules |

At the assumed 100-bps daily step, the cap is reached after 17 steps. A single available LP can therefore dominate funding and earn the entire face-value discount; this is a first-funder mechanism, not a competitive Dutch auction. The model does **not** produce a near-zero payout if the suggested 2,000-bps maximum is enforced: payout remains 80% of face value before any other deductions. However, the RFC describes 2,000 bps as a suggested ceiling, not an established enforced invariant. Without an enforced bound below 10,000 bps and a positive payout invariant, a pathological near-zero or non-positive payout is not ruled out by the written design.

### Assessment and parameter requirements

Thin participation does not create a price-clearing cliff: the rate advances deterministically and eventually saturates. It creates an **orderly but borrower-adverse degradation** up to the configured cap, followed by a funding cliff if no LP accepts that capped price before expiry. Single-LP domination is inherent in the first-funder rule and is plausible when participation is low; the RFC supplies no liquidity-depth data from which to estimate its probability.

Before implementation, make these invariants normative and test boundary cases:

1. Enforce `start_discount_bps <= max_discount_bps <= 2,000` (or another explicitly approved ceiling), and ensure the payout is always strictly positive after all fees.
2. Require `auction_step_bps > 0` and `step_interval_seconds` to be at least one ledger interval; use saturating or checked arithmetic before applying the cap.
3. Specify expiry and cancellation behavior at the cap, and make clear that an invoice may remain unfunded rather than silently extending the auction or lowering the seller's minimum proceeds.
4. Treat one-LP/full-invoice dominance as an accepted tradeoff for the early market. Revisit partial fills or a multi-LP clearing mechanism only when participation is sufficient to justify their added contract complexity.

These are proposed RFC clarifications, not assertions about deployed contract behavior. The current RFC status and implementation notes remain unchanged until the contract repository adopts and tests the invariants.

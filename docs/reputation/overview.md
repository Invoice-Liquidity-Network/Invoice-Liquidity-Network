# Reputation — Overview

This page describes how the ILN reputation system works, how scores are calculated and updated, the decay rules, LP filtering and discounts for high-reputation actors, and how reputation is surfaced in the UI.

**What the reputation system does**
- Tracks payer behaviour to help Liquidity Providers (LPs) decide which invoices to fund.
- Rewards reliable payers and submitters with better marketplace visibility and discount bonuses.

**ReputationScore struct (conceptual)**
The on-chain reputation record for an address is represented by a `ReputationScore` object. Conceptually it contains:

- `submitted: u32` — total invoices submitted where this address appears as the payer.
- `paid: u32` — total invoices that were submitted and later marked as paid.
- `score: u8` (0-100) — derived value computed from `paid` and `submitted`.
- `last_decay_ts: u64` — timestamp of the last decay application.
- `decay_halted: bool` — flag to disable automatic decay for this record (settable via governance or approved off-chain verification flows).

Note: the exact Rust struct in the smart contract may use different names or types; the above is the semantic shape used by the protocol and UI.

Computation
- The public score is computed as:

  score = if submitted == 0 then 0 else floor((paid / submitted) * 100)

  Example: 7 paid, 10 submitted → score = floor(7 / 10 * 100) = 70

Lifecycle events that change scores
- `submit_invoice()` — increments `submitted` for the invoice's payer (score recomputed).
- `mark_paid()` — increments `paid` for the invoice's payer and recomputes score.
- `invoice_default` (or a payment timeout) — if an invoice is marked defaulted or determined unpaid after the due window, the `submitted` count remains but `paid` does not increase; this lowers the computed score.
- Governance actions / oracle updates — external verification (e.g., KYC, dispute resolution) can be used to update `decay_halted` or otherwise adjust counts where appropriate.

Decay mechanism
- To ensure scores reflect recent behaviour, the protocol applies a time-based decay to historical counts. Decay is implemented by periodically reducing the influence of older `paid`/`submitted` events when recomputing the score. Conceptually this can be implemented as either:
  - A sliding window (e.g., last N months of invoices only), or
  - An exponential decay factor applied to `paid` and `submitted` based on age.
- The contract stores `last_decay_ts` and applies decay on events or via a scheduled indexer job that writes updated records on-chain.

Halting decay
- Decay can be halted for an individual address via a `decay_halted` flag. This is controlled by governance or an authorized off-chain verification process (e.g., identity verification) and is intended for exceptional cases where decay would be unfair (e.g., known long-term contracts with rare invoices).
- To request a halt to decay, a user must follow the protocol's appeal/verification process (see FAQ). Governance sets the policy for who may flip `decay_halted`.

LP threshold filtering
- LPs may set a minimum reputation threshold when browsing the marketplace or when configuring automated funders. In practice this means an LP will only see or accept invoices where the payer's `score >= threshold`.
- Thresholds are applied client-side by the LP UI and/or by indexer filters when returning candidate invoices for funding.

Discount bonus for high-reputation submitters
- The protocol encourages good behaviour by applying a bonus that improves terms for high-reputation submitters or payers. This is applied as a multiplier or subtraction on the requested discount rate when calculating LP offers.
- Example policy (illustrative): if a submitter's score >= 90, apply a 10% relative discount bonus to the requested discount rate. A submitter asking for 3.00% might effectively be treated as 2.70% for LPs evaluating risk.
- The exact bonus tiers and multipliers are governance parameters and can be adjusted.

How reputation appears in the UI
- Marketplace cards: payer reputation is shown prominently on invoice cards (numeric score and a small badge: e.g., `A (95)` / `Good (75)`), and invoices below an LP's threshold are visually de-emphasised or hidden.
- Profile pages: each user profile (payer or submitter) shows their `score` and a compact timeline of recent invoice activity (submitted / paid / defaulted), plus a short explanation of how the score is computed.
- Sorting and filters: LP UIs allow sorting by reputation and applying minimum-reputation filters; dashboards show aggregate distributions of scores for analytics.

Worked example — tracking a payer through 10 invoices

Assumptions
- No decay applied during these 10 invoices.
- A default reduces the effective paid count by not increasing it (i.e., submitted increases, paid does not).

Starting state: `submitted = 0`, `paid = 0`, `score = 0`

Invoice 1: paid
- submitted = 1, paid = 1 → score = floor(1/1*100) = 100

Invoice 2: paid
- submitted = 2, paid = 2 → score = 100

Invoice 3: paid
- submitted = 3, paid = 3 → score = 100

Invoice 4: unpaid (default)
- submitted = 4, paid = 3 → score = floor(3/4*100) = 75

Invoice 5: paid
- submitted = 5, paid = 4 → score = floor(4/5*100) = 80

Invoice 6: paid
- submitted = 6, paid = 5 → score = floor(5/6*100) = 83

Invoice 7: paid
- submitted = 7, paid = 6 → score = floor(6/7*100) = 85

Invoice 8: unpaid (late, eventually defaulted)
- submitted = 8, paid = 6 → score = floor(6/8*100) = 75

Invoice 9: paid
- submitted = 9, paid = 7 → score = floor(7/9*100) = 77

Invoice 10: paid
- submitted = 10, paid = 8 → score = floor(8/10*100) = 80

Summary: after 10 invoices with two defaults, the payer's score settles at 80. Improvements occur as paid invoices increase; defaults have a lasting impact until enough paid invoices restore the ratio.

FAQ

- Q: Why is my score lower than expected?
  - A: The score is a simple ratio of `paid` to `submitted` (×100). Missed or defaulted invoices increase `submitted` without increasing `paid`, lowering the ratio. Also check whether decay has reduced the influence of older paid invoices.

- Q: How does decay work?
  - A: Decay reduces the weight of older invoice events so scores reflect recent behaviour. The contract either applies a sliding window or an exponential decay factor; decay runs on-demand during score-updating events or via scheduled indexer actions. When decay runs, older paid events contribute less to `paid` and/or `submitted`, changing the computed score.

- Q: Can I appeal a default or request a correction?
  - A: Yes. Follow the protocol's dispute/appeal process (see the governance docs). If a default is resolved or an off-chain verification proves payment, governance or an authorised oracle can adjust counts or set `decay_halted` while the dispute is investigated.

Notes and governance
- Many policy choices (decay cadence, bonus tiers, who can halt decay) are governance parameters. Check the governance docs for the current values or to propose changes.

Further reading
- Protocol governance: governance.md
- Notifications and indexer behaviour (how events are surfaced to the UI): notifications.md and indexer/README

# Protocol Economics Explainer

This document outlines the economic model of the Invoice Liquidity Network (ILN). It explains how value is distributed between freelancers, liquidity providers (LPs), and the protocol, as well as the risks and rewards associated with participating in the network.

---

## 1. Core Economic Mechanics

ILN operates on a **discounted invoice factoring** model. Freelancers trade a small percentage of their invoice value for immediate liquidity, while LPs provide that liquidity in exchange for the discount amount as realized yield.

### The Yield Formula

All calculations use basis points (bps) for the discount rate. `1 bps = 0.01%`.

| Metric | Formula |
| :--- | :--- |
| **Discount Amount** | `floor(Invoice Amount * Discount Rate / 10,000)` |
| **Freelancer Payout** | `Invoice Amount - Discount Amount` |
| **LP Total Return** | `Invoice Amount + Discount Amount` (on successful payment) |
| **LP Realized Yield** | `Discount Amount` (Principal + Discount - Initial Funding) |
| **Effective APY (%)** | `(Discount Rate / 100) * (365 / Days to Due Date)` |

---

## 2. Three-Party Cash Flow

The lifecycle of an invoice involves three distinct financial movements:

1.  **Funding (Instant):** The LP calls `fund_invoice()`, sending the full **Invoice Amount** to the contract. The contract immediately transfers the **Freelancer Payout** to the freelancer and holds the **Discount Amount** in escrow.
2.  **Wait Period:** The contract holds the invoice in `Funded` status until the due date or settlement.
3.  **Settlement (Completion):** The Payer calls `mark_paid()`, sending the **Invoice Amount** to the contract. The contract then releases the **LP Total Return** (Principal + Discount) to the LP.

```text
Freelancer                  ILN Contract                  Liquidity Provider
    |                            |                               |
    |      [1] Fund Invoice      | <--- Sends $1,000 (Face) ---- |
    | <--- Pays $970 (Payout) -- |                               | 
    |                            | [ Contract Holds $30 Escrow ] |
    |                            |                               |
    |                            |       [2] Mark Paid           |
    |      [3] Settlement        | <--- Payer $1,000 (Face) ---- |
    |                            |                               |
    |                            | -- Releases $1,030 to LP ---> |
    |                            |     ($30 Realized Yield)      |
```

---

## 3. Fee Mechanics

The protocol may deduct a small fee from the realized yield to support the network's maintenance and governance treasury.

-   **Protocol Fee:** Typically a percentage of the **Discount Amount**.
-   **Deduction Point:** Fees are deducted at the moment of `mark_paid` or `claim_default`.
-   **Net LP Return:** `Total Return - Protocol Fee`.

---

## 4. Reputation and Discount Rates

ILN uses a Payer Reputation score to help participants price risk. 

-   **High Reputation:** Payers with a history of on-time payments (high score) signal lower default risk. Freelancers can offer lower discount rates (e.g., 100–200 bps) to attract LPs.
-   **Low Reputation / New:** Payers with low scores or no history represent higher risk. LPs will typically demand higher discount rates (e.g., 400–600 bps) to compensate for the uncertainty.
-   **Score Impact:** Successful settlements increase the payer's score (+1), while defaults significantly penalize it (-5), directly impacting their ability to have future invoices funded at competitive rates.

---

## 5. LP Risk Factors

LPs should be aware of three primary risks:

1.  **Default Risk:** The payer fails to settle the invoice. In this scenario, the LP cannot recover the principal from the contract. They can only use `claim_default` to recover the **escrowed discount amount** as a partial mitigation.
2.  **Dispute Risk:** A payer may refuse to pay if the freelancer did not fulfill the off-chain obligations (e.g., poor work quality). ILN is a "trustless" protocol for the transfer of funds, but it does not mediate off-chain service disputes.
3.  **Expiry/Liquidity Risk:** If an invoice is not funded by its due date, it may become stale. Once funded, the LP's capital is locked until the payer settles or a default is declared.

---

## 6. Worked Examples

Values assume USDC (7 decimals). `1,000,000,000` = `100 USDC`.

### Example A: Standard Successful Invoice
-   **Invoice Amount:** 1,000 USDC
-   **Discount Rate:** 300 bps (3%)
-   **Terms:** 30 days

*   **At Funding:** LP sends 1,000 USDC. Freelancer receives 970 USDC. Contract escrows 30 USDC.
*   **At Settlement:** Payer pays 1,000 USDC. LP receives 1,030 USDC.
*   **Result:** LP earns 30 USDC (36.5% effective APY).

### Example B: Partial Payment (Default Scenario)
*In this scenario, an invoice is funded but the payer fails to provide the full face value at maturity.*
-   **LP 1 Contribution:** 600 USDC
-   **LP 2 Contribution:** 400 USDC
-   **Discount Rate:** 500 bps (5% = 50 USDC total)

*   **At Funding:** Freelancer receives 950 USDC. 50 USDC is escrowed.
*   **At Default:** Payer fails to pay. LPs call `claim_default`.
*   **Result:** The 50 USDC escrow is split proportionally. LP 1 receives 30 USDC; LP 2 receives 20 USDC. (Note: Principal is lost, but the discount acts as a small insurance buffer).

### Example C: Disputed / Late Invoice
-   **Invoice Amount:** 5,000 USDC
-   **Discount Rate:** 200 bps (2% = 100 USDC)
-   **Due Date:** Jan 1st

*   **Scenario:** Payer disputes the work and delays payment until Feb 1st (31 days late).
*   **Result:** While the LP eventually receives 5,100 USDC, the delay reduces the **Effective APY** because the capital was locked for 60 days instead of 30.
*   **Reputation Impact:** Even if paid late, the protocol may allow LPs to report the delay, or the lack of an on-time `mark_paid` event will naturally prevent the payer's score from increasing as quickly as a timely payer.

---

## 7. Worst-Case Liquidity Stress Scenarios

This section documents three critical stress scenarios that could threaten LP liquidity and the protocol's stability, along with the explicit protocol responses defined for each.

### Scenario A: Simultaneous Large Defaults (Concentrated Loss Event)

**Condition:** Multiple large invoices from the same payer default in rapid succession, or multiple payers with correlated business failure default within the 30-day lookback window.

**Economic Consequence:**
- If 3+ invoices default within 30 days, total LP principal loss could exceed escrow buffer capacity.
- Example: Three 10,000 USDC invoices funded by the same 5 LPs, each with 300 bps discount (300 USDC escrow per invoice). If all default, the 900 USDC escrow covers only 3% of the 30,000 USDC principal loss.

**Protocol Response:**
1. **Fraud Signal Blocking:** The oracle service flags 2+ defaults within 30 days as a **blocking fraud signal**. Any new invoice from that payer cannot be funded until the 30-day window clears, even if KYB passes.
2. **LP Risk Gating:** The frontend's LP risk filter automatically dims invoices from payers with recent concentrated defaults, allowing risk-averse LPs to opt out.
3. **Insurance Pool:** LPs holding insurance pool positions recover up to 5% of their funding contribution (if insurance premium was paid), reducing individual LP loss to 95% of principal.
4. **Reputation Penalty:** The offending payer's reputation score is penalized by 5 points per default, making future funding significantly more expensive (higher discount rates required) or impossible if score drops below market minimum.

**Gaps & Follow-ups:**
- *No gap:* The protocol explicitly blocks repeated offenders via oracle fraud signals. See [`oracle-service.md`](./oracle-service.md) for fraud signal detail and [`ILN-Smart-Contract/docs/insurance-pool-design.md`](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/insurance-pool-design.md) for insurance mechanics.

---

### Scenario B: Prolonged Oracle Staleness (Verification Unavailability)

**Condition:** External KYB and reputation oracle providers experience outage or significant delay (>5 minutes) for >1 hour, rendering payer verification scores unavailable.

**Economic Consequence:**
- LPs cannot make informed risk decisions without reputation data.
- Uninformed LPs may fund high-risk payers at low discount rates, increasing portfolio loss exposure.
- Protocol could grind to a halt if oracle is mandatory for every funding.

**Protocol Response:**
1. **Graceful Degradation:** When oracle is unavailable, the service returns `verdict: "unknown"` with `confidence: 0`, **never** `unverified`. This signals data absence, not a negative verdict.
2. **Optional Requirement:** Oracle verification can be gated at the contract level, but LPs retain the option to fund at higher discount rates to compensate for unknown risk.
3. **Fallback to On-Chain History:** The oracle falls back to indexer-provided on-chain history (prior defaults, settlement latency) rather than blocking all transactions.
4. **SLO Monitoring:** Indexer and oracle service expose health endpoints and SLO violation metrics so operators can trigger escalation before impact reaches LPs.

**Gaps & Follow-ups:**
- *No gap:* Oracle unavailability is explicitly handled with "unknown" verdicts and fallback data. See [`oracle-service.md`](./oracle-service.md) for oracle composition and degradation modes, and [`threat-model.md`](./threat-model.md) for oracle attack surfaces.

---

### Scenario C: Thin-Liquidity Dutch-Auction Failure (Escrow Auction Collapse)

**Condition:** An invoice in funded state reaches its due date with insufficient payment received to settle all partial LP funders proportionally. The contract's Dutch-auction mechanism for escrow distribution faces a scenario where the calculated price falls below zero or auction exceeds time bounds.

**Economic Consequence:**
- Escrow distribution algorithm breaks down; LPs receive incorrect amounts.
- Freelancer may receive more than owed, or LP recovery is unfairly skewed.
- Loss of trust in contract fairness.

**Protocol Response:**
1. **Auction Bounds Enforcement:** The contract's Dutch-auction escrow split enforces a minimum floor price and maximum time bound (defined in the contract's `DEFAULT_AUCTION_WINDOW` parameter, set by governance). If the computed price overshoots, the transaction reverts and the freelancer cannot settle until the scenario is resolved.
2. **Partial Payment Handling:** When a payer pays less than the full invoice amount, the contract locks the partial payment and transitions the invoice to `PartiallyPaid` state. LPs and the freelancer must explicitly acknowledge and accept the partial settlement, ensuring no surprise distribution.
3. **Manual Dispute Resolution:** The `appeal_default` path gives payers a recourse channel if they dispute the auction outcome or claim technical error. Disputes are logged and can be reviewed by governance multi-sig.
4. **Governance Tuning:** If auction scenarios repeat, governance can adjust the `DEFAULT_AUCTION_WINDOW` or escrow distribution algorithm via timelock-protected parameter changes.

**Gaps & Follow-ups:**
- *No gap:* Dutch-auction logic is enforced on-chain and documented in the contract threat model. See [`ILN-Smart-Contract/docs/threat-model.md`](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/threat-model.md) for escrow and auction analysis, and the [`ILN-Smart-Contract/docs/trust-liquidity-model.md`](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/trust-liquidity-model.md) for governance parameters.

---

## 8. Stress Test Summary & Next Steps

| Scenario | Probability | Impact | Protocol Response | Residual Risk | Follow-up |
|---|---|---|---|---|---|
| Concentrated Defaults | Low (multi-payer required) | High (LP principal loss) | Fraud blocking, LP risk gating, insurance pool | LP still bears >95% loss if uninsured | Monitor default clustering; adjust 30-day window if needed |
| Oracle Staleness | Medium (third-party SLA) | Medium (uninformed decisions) | Graceful degradation to "unknown", on-chain fallback, health monitoring | LPs still take higher risk if they fund blind | Establish oracle provider SLA and failover contract |
| Escrow Auction Collapse | Very Low (algorithm tested) | Critical (fairness break) | Auction bounds, partial-payment lock, manual dispute, governance tuning | Residual only if governance parameters are misconfigured | Annual governance audit of escrow window and auction math |

**Next Step:** Integrate stress scenario results into LP onboarding materials and risk dashboards so LPs make informed capital allocation decisions.
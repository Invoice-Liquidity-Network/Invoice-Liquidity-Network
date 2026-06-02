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
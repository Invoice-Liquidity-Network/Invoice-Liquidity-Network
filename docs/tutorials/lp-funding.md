# LP Funding Tutorial

This tutorial walks liquidity providers through funding an invoice on ILN testnet, from acquiring USDC to reviewing the funded position in the LP dashboard.

## What you will learn

- How to acquire testnet USDC for funding
- How to browse the ILN marketplace for pending invoices
- How to evaluate invoice reputation, yield, and due date
- How to fund an invoice and confirm the token transfer
- How to monitor your funded position in the LP dashboard
- What discount rate means, how yield is calculated, and how settlement works

## 1. Acquire testnet USDC

Liquidity providers need testnet USDC and enough XLM to pay transaction fees.

1. Create or import a Stellar testnet account in your wallet (for example, Freighter). 
2. Fund the account using Friendbot:

```bash
curl "https://friendbot.stellar.org/?addr=YOUR_TESTNET_ACCOUNT_ID"
```

3. Add a USDC trustline if your wallet does not already have one.
   - USDC is an issued asset on Stellar testnet and requires a trustline before the account can receive it.
   - If you are using repository tooling, the CLI seeder automates this step: `iln dev seed`.

4. Receive or mint testnet USDC.
   - If you seeded testnet accounts with `iln dev seed`, the configured testnet issuer will mint USDC to your funded account.
   - If you are using another testnet deployment, ask the issuer or use the testnet token faucet for your environment.

> Tip: Keep extra XLM in the account so you can sign transactions and maintain the minimum Stellar reserve while also holding USDC.

## 2. Open the ILN marketplace

1. Open the Invoice Liquidity Network frontend and connect your wallet.
2. Navigate to the marketplace or invoice discovery page.
3. Filter or sort invoices by token, selecting `USDC` if you want to fund USDC invoices.

The marketplace shows invoices in `Pending` status that are available for funding.

## 3. Evaluate a pending invoice

Choose a pending invoice you want to fund and inspect these details carefully:

- **Reputation**
  - Review the payer reputation score and any available history. Higher reputation generally means lower default risk.
- **Yield / Discount rate**
  - The invoice discount rate is expressed in basis points (bps). For example, `300 bps` means `3.00%`.
- **Due date**
  - Confirm the invoice due date. Shorter maturities typically translate into higher effective APY for the same discount amount.
- **Payment token**
  - Make sure the invoice token is USDC if you are funding with USDC.

A well-structured invoice will balance a strong reputation score with a yield that fits your risk tolerance and target time horizon.

## 4. Fund the invoice

1. Click the fund button for the selected invoice.
2. Confirm the funding amount. In ILN, an LP typically funds the full invoice amount.
3. Approve the transaction in your wallet.

At funding time, ILN performs these actions:

- The LP sends the full invoice amount in USDC to the contract.
- The contract immediately pays the freelancer `amount − discount_amount`.
- The contract holds the discount amount in escrow.
- The invoice status changes from `Pending` to `Funded`.

## 5. Confirm token transfer

After your wallet approves the transaction:

- Verify the transaction succeeded in the wallet history.
- Confirm the invoice status is now `Funded` in the UI.
- Verify your USDC balance decreased by the invoice amount.

If the funding flow completed successfully, the UI should show your contribution and the invoice as funded.

## 6. Monitor your funded position in the LP dashboard

1. Open the LP dashboard or portfolio view.
2. Find the funded invoice under your active positions.
3. Check:
   - committed principal
   - expected payout
   - pending yield
   - due date

The LP dashboard helps you watch your position until the payer settles the invoice.

When the invoice is paid, the LP receives the full principal back plus the escrowed discount amount as yield.

## Understanding yield

### What the discount rate means

The invoice discount rate is the fee the LP earns for advancing liquidity. It is calculated in basis points.

- `100 bps` = `1.00%`
- `300 bps` = `3.00%`
- `500 bps` = `5.00%`

### How the funding cash flow works

When an LP funds a pending invoice, the contract:

- takes the full invoice amount from the LP
- pays the freelancer `amount − discount_amount`
- holds `discount_amount` in escrow until settlement

When the payer settles the invoice, the contract returns the full amount plus the escrowed discount to the LP. The LP’s net yield is the discount amount.

### Effective APY calculation

Because invoices have a finite due date, the discount rate can be converted into an annualized yield.

Use this formula:

```text
effective APY ≈ discount_rate% × (365 / days_to_due)
```

This is a simple approximation based on the invoice maturity.

### Worked example

Imagine a pending invoice with these terms:

- Invoice amount: `1,000 USDC`
- Discount rate: `300 bps` (`3.00%`)
- Due in: `30 days`

Calculate the escrowed discount:

```text
discount_amount = 1,000 × 0.03 = 30 USDC
```

At settlement, the LP receives:

```text
principal + yield = 1,000 + 30 = 1,030 USDC
```

Approximate effective APY:

```text
effective APY ≈ 3.00% × (365 / 30) ≈ 36.5%
```

### What happens on settlement

- If the payer settles on time, the LP recovers the full principal plus the escrowed discount amount.
- If the invoice defaults, the LP can claim only the escrowed discount amount as partial recovery.

> Note: The LP’s realized yield is only confirmed once the invoice is marked paid.

## Testnet guidance

These steps were written for the ILN testnet flow:

- use Friendbot to fund XLM for transaction fees
- add a USDC trustline before receiving USDC
- use the ILN frontend marketplace to fund pending invoices
- monitor funded invoices in the LP dashboard until the invoice is settled

For quick testnet setup, `iln dev seed` is the recommended path because it creates sample accounts, adds trustlines, and issues test USDC.

## Next step

Once you have funded an invoice and verified the funded position, explore how payer reputation and due date impact your next funding decision. Lower-risk invoices may offer lower discount rates, while higher-risk invoices can offer higher yield if you are comfortable with the additional reputational risk.

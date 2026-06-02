# Reputation Bonus Contract Reference

**Contract Address (Testnet)**: Variable (deployed per instance)

**RPC Endpoint**: https://soroban-testnet.stellar.org

---

## Overview

The Reputation Bonus Contract manages reputation-based discounts and hooks for the Invoice Liquidity Network. It provides reputation scoring, bonus calculations, and tracks invoice lifecycle events that affect reputation.

### Key Features

- **Reputation scoring** with configurable thresholds and decay
- **Bonus calculations** based on reputation tier
- **Minimum discount enforcement** to prevent exploits
- **Invoice lifecycle hooks** for submit, payment, default events
- **Configuration management** for all bonus parameters

---

## Data Types

### ReputationScore

```typescript
interface ReputationScore {
  address: Address;
  score: u32;                       // 0-100+ (can exceed 100)
  invoices_submitted: u64;          // Total submitted
  invoices_paid: u64;               // Successfully paid
  invoices_defaulted: u64;          // Defaulted count (penalty)
  last_activity_ledger: u64;        // When last updated
}
```

### Config

```typescript
interface Config {
  high_rep_threshold: u32;          // Score threshold for bonus tier
  bonus_bps: u32;                   // Additional discount for high-rep (bps)
  min_discount_rate_bps: u32;       // Floor discount rate (no negative rates)
}
```

### Invoice

```typescript
interface Invoice {
  id: u64;
  freelancer: Address;
  payer: Address;
  amount: i128;
  due_date: u64;
  base_discount_rate_bps: u32;      // Base rate (may be adjusted by reputation)
  effective_discount_rate_bps: u32; // Final rate (includes reputation bonus)
}
```

---

## Core Functions

### Initialization

#### `init(env, admin)`

**Access**: Anyone (first call only)

Initialize the reputation contract with admin.

**Parameters:**
- `admin: Address` - Contract admin

**Returns:** None

**Side Effects:**
- Sets admin account
- Initializes default configuration

**Example:**
```typescript
await reputationContract.init({
  admin: adminAddress
});
```

---

### Configuration Management

#### `set_config(config)`

**Access**: Admin only

Set all configuration parameters at once.

**Parameters:**
- `config: Config` - New configuration object

**Returns:** `Result<(), ContractError>`

**Errors:**
- `ConfigErrorUnauthorized` - Not admin

**Config Fields:**
- `high_rep_threshold: u32` - Score needed for bonus (e.g., 70)
- `bonus_bps: u32` - Extra discount for high-rep users (e.g., 100 = +1%)
- `min_discount_rate_bps: u32` - Minimum allowed discount (e.g., 50 = 0.5% floor)

**Example:**
```typescript
await reputationContract.setConfig({
  config: {
    high_rep_threshold: 70,
    bonus_bps: 150,        // +1.5% bonus for high-rep
    min_discount_rate_bps: 50
  }
});
```

---

#### `get_config()`

**Access**: Anyone

Get current configuration.

**Returns:** `Result<Config, ContractError>`

**Example:**
```typescript
const config = await reputationContract.getConfig();
console.log("High-rep threshold:", config.high_rep_threshold);
console.log("Bonus:", config.bonus_bps / 100, "%");
```

---

#### `update_config(caller, high_rep_threshold, bonus_bps, min_discount_rate_bps)`

**Access**: Admin only

Update individual configuration fields.

**Parameters:**
- `caller: Address` - Admin (must authenticate)
- `high_rep_threshold: u32` - New threshold score
- `bonus_bps: u32` - New bonus in bps
- `min_discount_rate_bps: u32` - New minimum discount

**Returns:** `Result<(), ContractError>`

**Errors:**
- `ConfigErrorUnauthorized` - Not admin

**Example:**
```typescript
await reputationContract.updateConfig({
  caller: adminAddress,
  highRepThreshold: 75,
  bonusBps: 200,
  minDiscountRateBps: 100
});
```

---

### Reputation Queries

#### `get_reputation(address)`

**Access**: Anyone

Retrieve an address's reputation profile.

**Parameters:**
- `address: Address` - Account to query

**Returns:** `ReputationScore`

**Fields:**
- `score: u32` - Current reputation score
- `invoices_submitted: u64` - Lifetime submitted count
- `invoices_paid: u64` - Successfully paid count
- `invoices_defaulted: u64` - Default count
- `last_activity_ledger: u64` - Last update timestamp

**Unknown Addresses:**
- Returns zeroed profile (all zeros)

**Example:**
```typescript
const rep = await reputationContract.getReputation({
  address: payerAddress
});

console.log("Score:", rep.score);
console.log("Lifetime paid:", rep.invoices_paid);
console.log("Defaults:", rep.invoices_defaulted);
```

---

### Invoice Lifecycle Hooks

#### `submit_invoice(freelancer, payer, amount, due_date, base_discount_rate_bps)`

**Access**: Anyone (hook for ILN contract)

Calculate effective discount rate with reputation bonus.

**Parameters:**
- `freelancer: Address` - Invoice recipient
- `payer: Address` - Obligor (reputation scored)
- `amount: i128` - Invoice amount
- `due_date: u64` - Settlement deadline
- `base_discount_rate_bps: u32` - Base discount from ILN

**Returns:** `Result<Invoice, ContractError>`

**Discount Calculation:**

```typescript
const payer_score = get_reputation(payer).score;
let effective_rate = base_discount_rate_bps;

if (payer_score >= high_rep_threshold) {
  effective_rate += bonus_bps;
}

// Enforce minimum discount floor
effective_rate = max(effective_rate, min_discount_rate_bps);
```

**Events:** None

**Example:**
```typescript
const invoice = await reputationContract.submitInvoice({
  freelancer: freelancerAddress,
  payer: payerAddress,
  amount: BigInt('10000000'),
  dueDate: futureTimestamp,
  baseDiscountRateBps: 300  // 3%
});

// If payer score >= 70: effective_rate = 300 + 150 = 450 (4.5%)
// If payer score < 70: effective_rate = 300 (3%)
console.log("Effective rate:", invoice.effective_discount_rate_bps);
```

---

#### `mark_paid(invoice_id)`

**Access**: Anyone (hook for ILN contract)

Update reputation on successful payment.

**Parameters:**
- `invoice_id: u64` - Invoice ID

**Returns:** `Result<(), ContractError>`

**Side Effects:**
- Increments payer's `invoices_paid` counter
- Updates payer's reputation score (typically increases)
- Records `last_activity_ledger`

**Example:**
```typescript
await reputationContract.markPaid({
  invoiceId: invoiceId
});
```

---

#### `handle_default(invoice_id)`

**Access**: Anyone (hook for ILN contract)

Update reputation on invoice default.

**Parameters:**
- `invoice_id: u64` - Defaulted invoice ID

**Returns:** `Result<(), ContractError>`

**Side Effects:**
- Increments payer's `invoices_defaulted` counter
- **Decreases payer's reputation** (penalty)
- Records `last_activity_ledger`

**Default Penalty:**
- Score decrease: typically -5 to -10 points (configurable)
- Floor: score cannot go below 0

**Example:**
```typescript
await reputationContract.handleDefault({
  invoiceId: invoiceId
});
```

---

## Reputation Scoring Model

### Score Range
- **0-100**: Standard reputation range
- **100+**: Possible for very reliable accounts
- **Floor**: 0 (never negative)

### Score Factors

| Event | Impact | Notes |
|-------|--------|-------|
| Invoice paid on time | +1 to +5 | Depends on configuration |
| Invoice defaulted | -5 to -10 | Configurable penalty |
| Successful appeal of default | +5 | Reverses penalty if upheld |
| Time decay | -0.1/day (config) | Optional: reputation naturally decays |

### Reputation Tiers

**Tier 1: Low Reputation** (score < threshold)
- Base discount rate applied
- May face payer minimum reputation requirement

**Tier 2: High Reputation** (score ≥ threshold)
- Base discount rate + bonus discount
- More attractive to LPs
- Faster approval on reputation-gated products

### Discount Tier Example

```
Config:
  high_rep_threshold: 70
  bonus_bps: 100  (1% extra)
  min_discount_rate_bps: 50

Scenario 1: Low rep (score = 40)
  base_rate: 300 bps (3%)
  score < 70: no bonus
  effective_rate: max(300, 50) = 300 bps

Scenario 2: High rep (score = 80)
  base_rate: 300 bps (3%)
  score ≥ 70: apply +100 bonus
  effective_rate: max(300 + 100, 50) = 400 bps (4%)

Scenario 3: Very low base_rate (high-risk)
  base_rate: 10 bps (0.1%)
  score ≥ 70: apply +100 bonus
  effective_rate: max(10 + 100, 50) = 100 bps (1%)
  → minimum floor prevents negative rates
```

---

## Error Codes

| Error | Code | Meaning |
|-------|------|---------|
| `ConfigErrorUnauthorized` | 1 | Caller not authorized to modify config |

---

## Integration Points

### Hook from Invoice Contract

The Invoice Liquidity Contract calls Reputation Contract functions:

1. **On `submit_invoice()`:**
   ```
   ILN → reputation.submit_invoice()
   Returns: adjusted discount rate
   ```

2. **On `mark_paid()`:**
   ```
   ILN → reputation.mark_paid()
   Payer reputation increases
   ```

3. **On `claim_default()`:**
   ```
   ILN → reputation.handle_default()
   Payer reputation decreases
   ```

### Coordination Pattern

```typescript
// In ILN contract
const effectiveRate = await reputationContract.submitInvoice({
  payer: payer,
  baseDiscountRate: proposedRate
});

// Use adjusted rate for invoice
const invoice = Invoice {
  discount_rate: effectiveRate.effective_discount_rate_bps,
  ...
};
```

---

## Configuration Strategy

### Conservative (low-risk)
```typescript
{
  high_rep_threshold: 80,    // Need high score for bonus
  bonus_bps: 50,             // Small bonus (0.5%)
  min_discount_rate_bps: 100 // Ensure minimum yield
}
```

### Moderate (balanced)
```typescript
{
  high_rep_threshold: 70,
  bonus_bps: 150,            // 1.5% bonus
  min_discount_rate_bps: 50
}
```

### Aggressive (high-growth)
```typescript
{
  high_rep_threshold: 50,    // Lower bar for bonus
  bonus_bps: 300,            // 3% bonus for high-rep
  min_discount_rate_bps: 10  // Allow very low rates
}
```

---

## Usage Example: End-to-End Flow

```typescript
// 1. Setup
const config = {
  high_rep_threshold: 70,
  bonus_bps: 100,
  min_discount_rate_bps: 50
};
await reputationContract.setConfig({ config });

// 2. New payer submits invoice (low score = 0)
const newPayerInvoice = await reputationContract.submitInvoice({
  payer: newPayerAddress,
  baseDiscountRateBps: 300
});
// Result: 300 bps (no bonus, under threshold)

// 3. Payer settles successfully
await reputationContract.markPaid({ invoiceId: newPayerInvoice.id });
// Payer score increases: 0 → 5

// 4. After multiple successful payments, score reaches 75
// Next invoice gets bonus:
const seasonedPayerInvoice = await reputationContract.submitInvoice({
  payer: seasonedPayerAddress,
  baseDiscountRateBps: 300
});
// Result: 400 bps (300 + 100 bonus)
// LPs get extra 1% yield as incentive for serving this payer

// 5. If later the payer defaults
await reputationContract.handleDefault({ invoiceId: someInvoiceId });
// Score decreases: 75 → 65
// Future invoices lose bonus again
```

---

## Best Practices

1. **Set reputation threshold strategically**
   - Too high: few users get bonus (low incentive)
   - Too low: bonus loses meaning

2. **Size the bonus appropriately**
   - Must exceed LP's risk premium for high-rep tier
   - Typical range: 0.5% - 3% additional yield

3. **Monitor default rates by reputation tier**
   - If high-rep tier has similar default rate to low-rep, consider adjustment
   - Default rate should decrease with reputation tier

4. **Avoid minimum discount from eliminating risk**
   - Minimum discount prevents negative rates (good)
   - But should not prevent yield-bearing invoices
   - Recommended: 0.1% - 1% minimum

5. **Coordinate with governance**
   - Use governance proposals to adjust config
   - Transparent threshold changes build trust

---

## Cross-References

- **Invoice Liquidity Contract**: [Invoice Contract Reference](./invoice-contract.md)
- **Governance Contract**: [Governance Contract Reference](./governance-contract.md)
- **Integration Guide**: [Integration & SDK Usage](../integration-guide.md)
- **Smart Contract Source**: [GitHub - Reputation Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/tree/main/contracts/reputation_bonus)

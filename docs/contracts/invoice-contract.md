# Invoice Liquidity Contract Reference

**Contract Address (Testnet)**: `CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC`

**RPC Endpoint**: https://soroban-testnet.stellar.org

---

## Overview

The Invoice Liquidity Contract is the core contract of the Invoice Liquidity Network (ILN). It manages the full lifecycle of invoices from submission through funding and settlement, including advanced features like reputation scoring, Dutch auctions, disputes, and appeals.

### Key Features

- **Multi-token support** (USDC, XLM, EURC)
- **Invoice lifecycle management** with state transitions
- **Flexible funding** with partial funding and LP priority queues
- **Reputation system** for payers and LPs with scoring and decay
- **Advanced mechanisms**: Dutch auctions, disputes, appeals, NFT representation
- **Oracle verification** for payer validation
- **Governance integration** for parameter updates
- **Multi-sig admin** capability for sensitive operations

---

## Data Types

### Invoice Status

Invoices transition through the following states:

```
Pending → [Funded or PartiallyFunded] → Paid (success)
       ↓
       → [Funded or PartiallyFunded] → Defaulted (after due date, no payment)
       ↓
       → [Funded or PartiallyFunded] → Disputed (payer contest before settlement)
       ↓
       → Cancelled (submitter cancels pending invoice)
```

**Status Values:**
- `Pending` - Invoice created, awaiting funding
- `PartiallyFunded` - LPs have funded part of the invoice amount
- `Funded` - Invoice fully funded, awaiting settlement
- `Paid` - Successfully settled by payer
- `Defaulted` - Payer did not pay by due date; LPs claimed principal
- `Appealed` - Payer appealed a default (admin review pending)
- `Disputed` - Payer disputed before settlement (admin review pending)
- `Expired` - Invoice never funded and due date passed
- `Cancelled` - Submitter cancelled pending invoice

### Invoice Structure

```typescript
interface Invoice {
  id: u64;                              // Unique invoice ID
  freelancer: Address;                  // Recipient of payout
  payer: Address;                       // Obligor to settle invoice
  token: Address;                       // Token address (USDC, XLM, or EURC)
  amount: i128;                         // Invoice amount in token's smallest unit
  due_date: u32;                        // Unix timestamp
  discount_rate: u32;                   // Basis points (bps) - LP yield
  status: InvoiceStatus;                // Current state
  funder: Option<Address>;              // Primary LP (or first multi-sig funder)
  funded_at: Option<u32>;               // Timestamp when fully funded
  amount_funded: i128;                  // Total capital deployed by LPs
  amount_paid: i128;                    // Cumulative payer payments
  referral_code: Option<BytesN<32>>;    // Optional referral tracking
  submitter_reputation: u32;            // Freelancer's reputation at submission
  allowed_lps: Option<Vec<Address>>;    // LP whitelist (max 10, if set)
  is_auction: bool;                     // Dutch auction flag
  auction_start_rate: Option<u32>;      // Initial discount rate (auction only)
  auction_min_rate: Option<u32>;        // Floor discount rate (auction only)
  auction_rate_decay_per_hour: Option<u32>; // BPS decay per hour (auction)
  auction_started_at: Option<u32>;      // Auction start timestamp
}
```

### ReputationProfile

```typescript
interface ReputationProfile {
  address: Address;
  payer_score: u32;                 // Range 0-100+, decays over time
  invoices_submitted: u64;          // Lifetime count
  invoices_paid: u64;               // On-time settlement count
  invoices_defaulted: u64;          // Default count (penalty)
}
```

### LPStats

Aggregated yield analytics for an LP (Issue #116):

```typescript
interface LPStats {
  total_funded: i128;               // Cumulative capital deployed (stroops)
  total_earned: i128;               // Cumulative yield received (stroops)
  active_positions: u64;            // Count of invoices in Funded status
  total_positions: u64;             // All-time funded invoice count
  avg_yield_bps: u32;               // Running average discount rate
}
```

---

## Core Functions

### Invoice Management

#### `initialize(env, admin, usdc_token, eurc_token, xlm_token)`

**Access**: Anyone (first call only)

Initialize the contract with admin and token addresses.

**Parameters:**
- `admin: Address` - Admin account for governance
- `usdc_token: Address` - USDC Stellar Asset Contract address
- `eurc_token: Address` - EURC Stellar Asset Contract address
- `xlm_token: Address` - XLM Stellar Asset Contract address

**Returns:** `Result<(), ContractError>`

**Errors:**
- `AlreadyInitialized` - Called more than once

**Events:** None

**Example:**
```typescript
const txn = await client.initialize({
  admin: adminAddress,
  usdc_token: 'CBIELTK6...',
  eurc_token: 'CA5DGX...',
  xlm_token: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4'
});
```

---

#### `submit_invoice(freelancer, payer, amount, due_date, discount_rate, token, referral_code?, allowed_lps?)`

**Access**: Submitter only (authenticated)

Create a new invoice pending funding.

**Parameters:**
- `freelancer: Address` - Payout recipient (must authenticate)
- `payer: Address` - Settlement obligor
- `amount: i128` - Invoice amount (stroops; min 1,000,000)
- `due_date: u64` - Unix timestamp (24 hours to 365 days in future)
- `discount_rate: u32` - LP yield in basis points (1-5000 bps)
- `token: Address` - Payment token address
- `referral_code?: BytesN<32>` - Optional referral tracking (Issue #118)
- `allowed_lps?: Vec<Address>` - LP whitelist (max 10 addresses)

**Returns:** `Result<u64, ContractError>` - Invoice ID

**Errors:**
- `ContractPaused` - Contract is in pause state
- `Unauthorized` - `freelancer` != authenticated caller
- `SelfInvoice` - `freelancer == payer`
- `InvalidDiscountRate` - `discount_rate` is 0 or exceeds max
- `InvalidAmount` - Amount below minimum
- `InvalidDueDate` - Date not in valid range
- `DueDateTooSoon` - Due date < 24 hours
- `DueDateTooFar` - Due date > 365 days
- `Unauthorized` - Token not in allowlist

**Events:**
- `InvoiceSubmitted` - Contains invoice_id, parties, token, terms, status

**Side Effects:**
- Increments submitter's `invoices_submitted` reputation counter
- Mints invoice NFT to freelancer (Issue #119)
- Tracks referral code usage if provided
- Captures freelancer's reputation score at submission

**Example:**
```typescript
const invoiceId = await client.submitInvoice({
  freelancer: freelancerAddress,
  payer: payerAddress,
  amount: BigInt('10000000'),    // 1 USDC (6 decimals)
  dueDate: Math.floor(Date.now() / 1000) + 86400 * 30,
  discountRate: 300,             // 3% yield
  token: usdcAddress,
  referralCode: referralHash,
  allowedLps: [lp1, lp2]         // Private funding
});
```

---

#### `submit_invoice_auction(freelancer, payer, amount, due_date, start_rate, min_rate, rate_decay_per_hour, token, referral_code?)`

**Access**: Submitter only

Create an invoice with Dutch auction funding (Issue #108).

**Parameters:**
- `freelancer: Address` - Payout recipient
- `payer: Address` - Settlement obligor
- `amount: i128` - Invoice amount
- `due_date: u64` - Settlement due date
- `start_rate: u32` - Initial discount rate (bps)
- `min_rate: u32` - Floor discount rate (bps)
- `rate_decay_per_hour: u32` - Rate decrease per hour (bps)
- `token: Address` - Payment token
- `referral_code?: BytesN<32>` - Optional referral

**Returns:** `Result<u64, ContractError>` - Invoice ID

**Errors:**
- Same as `submit_invoice` plus:
- `InvalidAuctionParams` - Invalid rate configuration or decay = 0

**Events:**
- `AuctionStarted` - Auction parameters published

**Side Effects:**
- Sets `is_auction = true`
- Stores auction parameters
- Records auction start time

**Example:**
```typescript
const auctionInvoiceId = await client.submitInvoiceAuction({
  freelancer: freelancerAddress,
  payer: payerAddress,
  amount: BigInt('10000000'),
  dueDate: futureTimestamp,
  startRate: 500,         // 5% initial
  minRate: 50,            // 0.5% floor
  rateDecayPerHour: 10,   // Decreases 10 bps/hour
  token: usdcAddress
});
```

---

#### `fund_invoice(funder, invoice_id, fund_amount, require_oracle_verification?)`

**Access**: LP only

Contribute capital to an invoice.

**Parameters:**
- `funder: Address` - LP account (must authenticate)
- `invoice_id: u64` - Target invoice ID
- `fund_amount: i128` - Capital contribution
- `require_oracle_verification?: bool` - Verify payer via oracle (default false)

**Returns:** `Result<(), ContractError>`

**Errors:**
- `ContractPaused`
- `Unauthorized` - `funder` != caller
- `InvoiceNotFound`
- `AlreadyFunded` - Invoice fully funded
- `AlreadyPaid` - Invoice already settled
- `NotFunded` - Attempting action on non-funded invoice
- `PayerReputationTooLow` - Payer below minimum reputation (if configured)
- `PayerUnverified` - Oracle verification failed
- `OracleDataStale` - Oracle data exceeds max age (Issue #93)
- `OverfundingRejected` - Contribution exceeds remaining amount
- `LPNotWhitelisted` - LP not in allowed list (if whitelist set)
- `NotApprovedFunder` - Queue resolution selected different LP (Issue #34)
- `InvoiceExpired` - Due date already passed

**Events:**
- `InvoiceFunded` - Funding confirmed; includes effective yield
- `AuctionFunded` - For auction invoices (includes hours elapsed)

**Side Effects:**
- Transfers funds from LP to contract
- Updates LP score (+1 on successful funding)
- Records LP as contributor (multiple LPs can fund)
- If fully funded: transfers payout to freelancer (minus discount)
- Updates invoice status (PartiallyFunded or Funded)
- Transfers invoice NFT to LP if fully funded (Issue #119)
- Updates LP portfolio stats (Issue #116)
- Calls distribution contract to accrue LP yield

**Oracle Verification (Issue #92-93):**

When `require_oracle_verification = true`:
1. Queries oracle contract via `get_payer_data(payer)`
2. Checks: oracle response timestamp freshness (< `max_oracle_age_ledgers`)
3. Checks: oracle's `is_verified` flag

If either check fails, returns error. Governance can disable freshness check by setting `max_oracle_age_ledgers = 0`.

**Example:**
```typescript
await client.fundInvoice({
  funder: lpAddress,
  invoiceId: invoiceId,
  fundAmount: BigInt('5000000'),   // 0.5 USDC
  requireOracleVerification: true
});
```

---

#### `mark_paid(payer, invoice_id, amount)`

**Access**: Payer only

Record a payment toward an invoice.

**Parameters:**
- `payer: Address` - Payer account (must authenticate)
- `invoice_id: u64` - Invoice ID
- `amount: i128` - Payment amount (stroops)

**Returns:** `Result<(), ContractError>`

**Errors:**
- `ContractPaused`
- `InvalidAmount` - Amount ≤ 0
- `InvoiceNotFound`
- `NotFunded` - Invoice not yet funded
- `AlreadyPaid` - Invoice already settled
- `OverpaymentRejected` - Payment exceeds remaining balance
- `InvoiceExpired` - After due date without full funding

**Events:**
- `InvoicePartiallyPaid` - Partial payment recorded
- `InvoicePaid` - Full settlement; includes earned yield

**Side Effects (on full payment):**
- Transfers protocol fee to treasury (if configured)
- Distributes funds proportionally to all LPs
- Updates payer score (+1)
- Updates LP portfolio stats (each LP gets `total_earned` updated)
- Burns invoice NFT (Issue #119)
- Increments `invoices_paid` counter for payer and freelancer
- Calls distribution contract to accrue settlement bonuses
- Emits all fees collected events

**Example:**
```typescript
await client.markPaid({
  payer: payerAddress,
  invoiceId: invoiceId,
  amount: BigInt('10000000')  // Full invoice
});
```

---

#### `claim_default(funder, invoice_id)`

**Access**: LP only

Claim principal + penalty refund after due date with no settlement.

**Parameters:**
- `funder: Address` - LP claiming refund
- `invoice_id: u64` - Defaulted invoice

**Returns:** `Result<(), ContractError>`

**Errors:**
- `ContractPaused`
- `Unauthorized` - Not LP on invoice
- `InvoiceNotFound`
- `NotFunded` - Invoice not funded
- `NotYetDefaulted` - Before due date or paid already
- `AlreadyPaid` - Invoice settled
- `InvoiceDefaulted` - Already defaulted

**Events:**
- `InvoiceDefaulted` - Includes all funders' refund amounts

**Side Effects:**
- Refunds all LPs: principal amount (minus discount earned)
- Marks invoice status as `Defaulted`
- **Penalizes payer**: reduces score by 5 (floor 0)
- Increments payer's `invoices_defaulted` counter
- Snapshots pre-default payer score for potential appeal

**Reputation Penalty:**
- Payer reputation: `score = max(0, score - 5)`

**Example:**
```typescript
await client.claimDefault({
  funder: lpAddress,
  invoiceId: invoiceId
});
```

---

### Advanced: Disputes & Appeals

#### `dispute_invoice(payer, invoice_id, reason_hash)`

**Access**: Payer only

Contest an invoice before settlement (Issue #40).

**Parameters:**
- `payer: Address` - Payer (must authenticate)
- `invoice_id: u64` - Invoice to dispute
- `reason_hash: BytesN<32>` - SHA-256 hash of dispute evidence (off-chain)

**Returns:** `Result<(), ContractError>`

**Errors:**
- `ContractPaused`
- `InvoiceNotFound`
- `Unauthorized` - Not payer
- `AlreadyDisputed` - Already disputed
- `AlreadyPaid` - After settlement
- `AlreadyDefaulted` - After default

**Allowed States**: Pending, PartiallyFunded, Funded

**Events:**
- `InvoiceDisputed` - Reason hash published

**Side Effects:**
- Transitions invoice to `Disputed` status
- Stores dispute record with evidence hash and timestamp

**Example:**
```typescript
const reasonHash = await hashSHA256("Goods damaged in shipping");
await client.disputeInvoice({
  payer: payerAddress,
  invoiceId: invoiceId,
  reasonHash: reasonHash
});
```

---

#### `resolve_dispute(admin, invoice_id, resolution_hash, resolution)`

**Access**: Admin only

Resolve a pending dispute (Issue #40).

**Parameters:**
- `admin: Address` - Admin (must authenticate)
- `invoice_id: u64` - Disputed invoice
- `resolution_hash: BytesN<32>` - SHA-256 hash of resolution details
- `resolution: u32` - Ruling (1 = Upheld/Payer right, 2 = Rejected/Freelancer right)

**Returns:** `Result<(), ContractError>`

**Errors:**
- `InvoiceNotFound`
- `NotDisputed` - Invoice not in Disputed status

**Events:**
- `DisputeResolved` - Resolution published

**Side Effects (if upheld = 1):**
- Refunds all LPs (minus earned discount)
- Marks invoice `Cancelled`

**Side Effects (if rejected = 2):**
- Restores invoice to pre-dispute state (Pending/PartiallyFunded/Funded)

**Example:**
```typescript
await client.resolveDispute({
  admin: adminAddress,
  invoiceId: invoiceId,
  resolutionHash: resolutionHash,
  resolution: 1  // Upheld
});
```

---

#### `appeal_default(payer, invoice_id, evidence_hash)`

**Access**: Payer only

Appeal a default marking (Issue #36).

**Parameters:**
- `payer: Address` - Payer (must authenticate)
- `invoice_id: u64` - Defaulted invoice
- `evidence_hash: BytesN<32>` - SHA-256 hash of off-chain evidence

**Returns:** `Result<(), ContractError>`

**Errors:**
- `InvoiceNotFound`
- `NotDefaulted` - Invoice not in Defaulted status
- `AlreadyAppealed` - Appeal already filed
- `AppealWindowClosed` - Beyond 30-day appeal window

**Appeal Window**: 30 days from due date

**Events:**
- `DefaultAppealed` - Evidence hash published

**Side Effects:**
- Transitions invoice to `Appealed` status
- Stores pre-default payer score snapshot (for restoration if upheld)

**Example:**
```typescript
const evidenceHash = await hashSHA256("Proof of payment: [receipt details]");
await client.appealDefault({
  payer: payerAddress,
  invoiceId: invoiceId,
  evidenceHash: evidenceHash
});
```

---

#### `resolve_appeal(admin, invoice_id, upheld)`

**Access**: Admin only

Resolve a pending appeal (Issue #36).

**Parameters:**
- `admin: Address` - Admin (must authenticate)
- `invoice_id: u64` - Appealed invoice
- `upheld: bool` - true = reverse default, false = reject appeal

**Returns:** `Result<(), ContractError>`

**Errors:**
- `InvoiceNotFound`
- `NotDefaulted` - Invoice not in Appealed status (internally checked via Appealed status)

**Events:**
- `AppealResolved` - Outcome published

**Side Effects (if upheld = true):**
- **Restores payer reputation** to pre-default score
- Decrements payer's `invoices_defaulted` counter
- Transitions invoice back to `Defaulted` (LP still keeps refund)

**Side Effects (if upheld = false):**
- Invoice remains `Defaulted`
- Reputation penalty stays in effect

**Example:**
```typescript
await client.resolveAppeal({
  admin: adminAddress,
  invoiceId: invoiceId,
  upheld: true  // Accept appeal
});
```

---

### LP Priority Queue (Issue #34)

#### `join_fund_queue(lp, invoice_id)`

**Access**: LP only

Register intent to fund an invoice with reputation priority.

**Parameters:**
- `lp: Address` - LP account (must authenticate)
- `invoice_id: u64` - Target invoice

**Returns:** `Result<(), ContractError>`

**Errors:**
- `Unauthorized` - Not LP
- `InvoiceNotFound`
- `AlreadyInQueue` - LP already queued for this invoice
- `NotApprovedFunder` - Queue already resolved (too late)
- `AlreadyFunded` - Invoice fully funded
- `AlreadyPaid` - Invoice settled

**Events:**
- `FundRequested` - LP added to queue with reputation score

**Side Effects:**
- Snapshots LP's current reputation score
- Adds LP to queue (allows multiple LPs to express interest)

**Example:**
```typescript
await client.joinFundQueue({
  lp: lpAddress,
  invoiceId: invoiceId
});
```

---

#### `resolve_fund_queue(any_account, invoice_id)`

**Access**: Anyone

Select the highest-reputation LP as approved funder (Issue #34).

**Parameters:**
- `invoice_id: u64` - Invoice to resolve queue for

**Returns:** `Result<Address, ContractError>` - Approved LP address

**Errors:**
- `InvoiceNotFound`
- `NotFunded` - No LPs in queue

**Events:**
- `FundQueueResolved` - Winning LP published

**Side Effects:**
- Stores approved LP address
- Once resolved, only approved LP can fund

**Queue Selection:**
- Highest reputation score wins (ties: first-come-first-served)

**Example:**
```typescript
const approvedLp = await client.resolveFundQueue({
  invoiceId: invoiceId
});
console.log("Approved LP:", approvedLp);
```

---

### Query & Analytics Functions

#### `get_invoice(invoice_id)`

**Access**: Anyone

Retrieve full invoice details.

**Parameters:**
- `invoice_id: u64` - Invoice ID

**Returns:** `Result<Invoice, ContractError>`

**Errors:**
- `InvoiceNotFound`

**Example:**
```typescript
const invoice = await client.getInvoice({
  invoiceId: invoiceId
});
```

---

#### `get_reputation(address)`

**Access**: Anyone

Get an address's reputation profile.

**Parameters:**
- `address: Address` - Account to query

**Returns:** `ReputationProfile`

**Fields:**
- `payer_score: u32` - 0-100+ (decays over time)
- `invoices_submitted: u64`
- `invoices_paid: u64`
- `invoices_defaulted: u64`

**Unknown addresses** return a zeroed profile (no error).

**Example:**
```typescript
const rep = await client.getReputation({
  address: payerAddress
});
console.log("Score:", rep.payer_score);
console.log("Paid:", rep.invoices_paid);
```

---

#### `payer_score(payer)`

**Access**: Anyone

Get a payer's current reputation score.

**Parameters:**
- `payer: Address` - Account to query

**Returns:** `u32` - Score (0+)

**Example:**
```typescript
const score = await client.payerScore({ payer: payerAddress });
```

---

#### `lp_score(lp)`

**Access**: Anyone

Get an LP's current reputation score (Issue #34).

**Parameters:**
- `lp: Address` - LP account

**Returns:** `u32` - Score

**Example:**
```typescript
const score = await client.lpScore({ lp: lpAddress });
```

---

#### `get_lp_portfolio_stats(lp)`

**Access**: Anyone

Get LP's yield analytics snapshot (Issue #116).

**Parameters:**
- `lp: Address` - LP account

**Returns:** `LPStats`

**Fields:**
- `total_funded: i128` - Cumulative capital deployed
- `total_earned: i128` - Cumulative yield received
- `active_positions: u64` - Invoices in Funded state
- `total_positions: u64` - All-time funded invoices
- `avg_yield_bps: u32` - Average discount rate

**Example:**
```typescript
const stats = await client.getLpPortfolioStats({
  lp: lpAddress
});
console.log("Total Earned:", stats.total_earned);
console.log("Active Positions:", stats.active_positions);
console.log("Average Yield:", stats.avg_yield_bps / 100 + "%");
```

---

#### `get_invoice_count(state?)`

**Access**: Anyone

Get invoice count (total or by status).

**Parameters:**
- `state?: InvoiceStatus` - Filter by status (optional)

**Returns:** `u64` - Count

**Example:**
```typescript
const total = await client.getInvoiceCount();
const funded = await client.getInvoiceCount({ state: 'Funded' });
```

---

#### `list_invoices_by_submitter(submitter, page, page_size)`

**Access**: Anyone

Get paginated invoices submitted by an address (Issue #39).

**Parameters:**
- `submitter: Address` - Submitter account
- `page: u32` - Page number (0-indexed)
- `page_size: u32` - Items per page (max 50)

**Returns:** `Vec<Invoice>`

**Example:**
```typescript
const page1 = await client.listInvoicesBySubmitter({
  submitter: freelancerAddress,
  page: 0,
  pageSize: 20
});
```

---

#### `list_invoices_by_lp(lp, page, page_size)`

**Access**: Anyone

Get paginated invoices funded by an LP.

**Parameters:**
- `lp: Address` - LP account
- `page: u32` - Page number
- `page_size: u32` - Items per page (max 50)

**Returns:** `Vec<Invoice>`

**Example:**
```typescript
const lpInvoices = await client.listInvoicesByLp({
  lp: lpAddress,
  page: 0,
  pageSize: 20
});
```

---

#### `get_contract_stats()`

**Access**: Anyone

Get contract-wide statistics (Issue #115).

**Returns:** `ContractStats`

**Fields:**
- `total_invoices: u64` - All-time invoice count
- `total_funded: u64` - Total invoices fully funded
- `total_paid: u64` - Total invoices settled
- `total_volume: i128` - Cumulative funding across all tokens

**Example:**
```typescript
const stats = await client.getContractStats();
console.log("Total Volume:", stats.total_volume);
```

---

### Administrative Functions

#### `set_admin(new_admin)`

**Access**: Admin only

Transfer admin privileges.

**Parameters:**
- `new_admin: Address` - New admin account

**Returns:** `Result<(), ContractError>`

**Errors:**
- `Unauthorized` - Not current admin

**Events:**
- `AdminChanged` - Old and new admin published

**Example:**
```typescript
await client.setAdmin({
  newAdmin: newAdminAddress
});
```

---

#### `update_fee_rate(rate)`

**Access**: Admin only

Set protocol fee (basis points).

**Parameters:**
- `rate: u32` - Fee in basis points (0-100 bps)

**Returns:** `Result<(), ContractError>`

**Events:**
- `ParameterUpdated` - Old/new fee published

**Example:**
```typescript
await client.updateFeeRate({ rate: 50 });  // 0.5%
```

---

#### `update_protocol_fee_bps(bps)`

**Access**: Admin only

Set protocol fee on LP earnings (Issue #67).

**Parameters:**
- `bps: u32` - Fee in basis points (max 100)

**Returns:** `Result<(), ContractError>`

**Events:**
- `ParameterUpdated`

**Example:**
```typescript
await client.updateProtocolFeeBps({ bps: 100 });  // 1% of earnings to treasury
```

---

#### `add_token(token)`

**Access**: Admin only

Approve a token for invoicing.

**Parameters:**
- `token: Address` - Token address

**Returns:** `Result<(), ContractError>`

**Validation:**
- Rejects fee-on-transfer tokens (test transfer required)

**Events:**
- `TokenAdded`

**Example:**
```typescript
await client.addToken({
  token: newTokenAddress
});
```

---

#### `remove_token(token)`

**Access**: Admin only

Remove a token from allowlist.

**Parameters:**
- `token: Address` - Token address

**Returns:** `Result<(), ContractError>`

**Events:**
- `TokenRemoved`

**Example:**
```typescript
await client.removeToken({
  token: tokenAddress
});
```

---

#### `pause()` / `unpause()`

**Access**: Admin only

Emergency pause/unpause all contract operations.

**Returns:** `Result<(), ContractError>`

**Events:**
- `ContractPaused` / `ContractUnpaused`

**Paused State Effects:**
- All state-changing functions reject with `ContractPaused`
- Query functions still work

**Example:**
```typescript
await client.pause();
// ... address emergency
await client.unpause();
```

---

#### `set_min_payer_reputation(value)`

**Access**: Admin only

Set minimum payer reputation to fund invoices (Issue #28).

**Parameters:**
- `value: u32` - Minimum score (0 = disabled)

**Returns:** `Result<(), ContractError>`

**Events:**
- `ParameterUpdated`

**Example:**
```typescript
await client.setMinPayerReputation({ value: 50 });
```

---

#### `min_payer_reputation()`

**Access**: Anyone

Get current minimum payer reputation threshold.

**Returns:** `u32`

**Example:**
```typescript
const minRep = await client.minPayerReputation();
```

---

#### `set_max_oracle_age(max_age_ledgers)`

**Access**: Admin only

Set maximum oracle data freshness window (Issue #93).

**Parameters:**
- `max_age_ledgers: u64` - Max age in ledgers (0 = disable check)

**Returns:** `Result<(), ContractError>`

**Default:** ~24 hours at ~5s/ledger ≈ 17,280 ledgers

**Example:**
```typescript
await client.setMaxOracleAge({
  maxAgeLedgers: BigInt(20000)
});
```

---

#### `get_max_oracle_age()`

**Access**: Anyone

Get current maximum oracle age setting.

**Returns:** `u64` - Ledgers

**Example:**
```typescript
const maxAge = await client.getMaxOracleAge();
```

---

### Multi-Signature Admin (Issue #124)

#### `initialize_multisig_admin(signers, threshold)`

**Access**: Admin only

Set up multi-signature requirements for sensitive operations.

**Parameters:**
- `signers: Vec<Address>` - Authorized signers
- `threshold: u32` - Signatures required (must be ≤ signers.len())

**Returns:** `Result<(), ContractError>`

**Errors:**
- `InvalidMultisigConfig` - Threshold > signers or threshold = 0

**Example:**
```typescript
await client.initializeMultisigAdmin({
  signers: [signer1, signer2, signer3],
  threshold: 2  // 2-of-3 multisig
});
```

---

#### `propose_pause(proposer)` / `propose_unpause(proposer)`

**Access**: Multi-sig authorized signer

Propose a pause/unpause action.

**Parameters:**
- `proposer: Address` - Signer (must be in authorized list)

**Returns:** `Result<u64, ContractError>` - Proposal ID

**Errors:**
- `NotAuthorizedSigner` - Not in multisig signer list

**Example:**
```typescript
const proposalId = await client.proposePause({
  proposer: signer1Address
});
```

---

#### `sign_proposal(signer, proposal_id)`

**Access**: Multi-sig authorized signer

Add signature to proposal.

**Parameters:**
- `signer: Address` - Signer (must authenticate)
- `proposal_id: u64` - Proposal to sign

**Returns:** `Result<(), ContractError>`

**Errors:**
- `NotAuthorizedSigner`
- `AlreadySigned` - Signer already voted
- `ProposalNotFound`

**Example:**
```typescript
await client.signProposal({
  signer: signer2Address,
  proposalId: proposalId
});
```

---

#### `execute_proposal(executor, proposal_id)`

**Access**: Multi-sig authorized signer

Execute a proposal once threshold reached.

**Parameters:**
- `executor: Address` - Signer executing (must authenticate)
- `proposal_id: u64` - Proposal to execute

**Returns:** `Result<(), ContractError>`

**Errors:**
- `ThresholdNotReached` - Not enough signatures
- `ProposalNotFound`
- `ProposalAlreadyExecuted` - Already executed
- `ProposalExpired` - Outside execution window

**Execution Window:** ~14 days from proposal creation

**Example:**
```typescript
await client.executeProposal({
  executor: signer3Address,
  proposalId: proposalId
});
```

---

## Event Schema

### Invoice Lifecycle Events

**InvoiceSubmitted**
```typescript
{
  invoice_id: u64,
  freelancer: Address,
  payer: Address,
  token: Address,
  amount: i128,
  due_date: u64,
  discount_rate: u32,
  referral_code?: BytesN<32>,
  status: InvoiceStatus,
  timestamp: u64,
  allowed_lps?: Vec<Address>
}
```

**InvoiceFunded**
```typescript
{
  invoice_id: u64,
  funder: Address,
  freelancer: Address,
  payer: Address,
  token: Address,
  fund_amount: i128,
  amount_funded: i128,
  invoice_amount: i128,
  due_date: u64,
  discount_rate: u32,
  funded_at: u64,
  status: InvoiceStatus,
  lp: Address,
  effective_yield_bps: u32,
  timestamp: u64
}
```

**InvoicePaid**
```typescript
{
  invoice_id: u64,
  payer: Address,
  lp: Address,
  freelancer: Address,
  token: Address,
  amount_paid: i128,
  lp_earned: i128,
  lp_payout: i128,
  settlement_timestamp: u64,
  paid_on_time: bool,
  status: InvoiceStatus
}
```

**InvoiceDefaulted**
```typescript
{
  invoice_id: u64,
  funder: Address,
  freelancer: Address,
  payer: Address,
  token: Address,
  amount: i128,
  due_date: u64,
  defaulted_at: u64,
  discount_amount: i128,
  status: InvoiceStatus
}
```

---

## Error Codes

| Error | Code | Meaning |
|-------|------|---------|
| `AlreadyInitialized` | 1 | Contract already initialized |
| `InvoiceNotFound` | 2 | Invoice ID does not exist |
| `Unauthorized` | 3 | Caller not authorized |
| `InvalidAmount` | 4 | Amount is invalid (zero/negative) |
| `InvalidDueDate` | 5 | Due date outside valid range |
| `InvalidDiscountRate` | 6 | Discount rate is zero or too high |
| `ContractPaused` | 7 | Contract is paused |
| `AlreadyFunded` | 8 | Invoice already fully funded |
| `NotFunded` | 9 | Invoice not yet funded |
| `AlreadyPaid` | 10 | Invoice already paid |
| `OverfundingRejected` | 11 | Contribution exceeds remaining |
| `SelfInvoice` | 12 | Freelancer cannot be payer |
| `InvoiceExpired` | 13 | Invoice due date passed |
| `NotYetDefaulted` | 14 | Default window not reached |
| `InvoiceDefaulted` | 15 | Invoice already defaulted |
| `AppealWindowClosed` | 16 | Appeal window (30 days) expired |
| `AlreadyAppealed` | 17 | Appeal already filed |
| `NotDefaulted` | 18 | Invoice not in Defaulted status |
| `PayerReputationTooLow` | 19 | Payer below minimum reputation |
| `PayerUnverified` | 20 | Oracle verification failed |
| `OracleDataStale` | 21 | Oracle data exceeds max age |
| `FeeOnTransferToken` | 22 | Token has fee-on-transfer behavior |
| `DueDateTooSoon` | 23 | Due date < 24 hours away |
| `DueDateTooFar` | 24 | Due date > 365 days away |
| `NotAuthorizedSigner` | 25 | Not in multisig signer list |
| `AlreadySigned` | 26 | Signer already voted |
| `ThresholdNotReached` | 27 | Not enough multisig signatures |
| `ProposalNotFound` | 28 | Proposal ID does not exist |
| `ProposalAlreadyExecuted` | 29 | Proposal already executed |
| `ProposalExpired` | 30 | Proposal execution window passed |
| `InvalidMultisigConfig` | 31 | Multisig threshold invalid |
| `AlreadyInQueue` | 32 | LP already in fund queue |
| `NotApprovedFunder` | 33 | Different LP selected by queue |
| `LPNotWhitelisted` | 34 | LP not in allowed list |
| `WhitelistTooLarge` | 35 | Whitelist exceeds max (10) |
| `BatchTooLarge` | 36 | Batch submission > 10 items |
| `AlreadyDisputed` | 37 | Invoice already disputed |
| `NotDisputed` | 38 | Invoice not in Disputed status |
| `AlreadyCancelled` | 39 | Invoice already cancelled |
| `InvoiceAppealed` | 40 | Invoice in Appealed status |
| `InvoiceNftNotFound` | 41 | No NFT for invoice |
| `InvalidAuctionParams` | 42 | Auction parameters invalid |

---

## Cross-References

- **Event Schema**: [Event Documentation](../event-schema.md)
- **Governance Integration**: [Governance Contract Reference](./governance-contract.md)
- **Reputation System**: [Reputation Contract Reference](./reputation-contract.md)
- **Integration Guide**: [Integration & SDK Usage](../integration-guide.md)
- **Smart Contract Source**: [GitHub - ILN Smart Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract)

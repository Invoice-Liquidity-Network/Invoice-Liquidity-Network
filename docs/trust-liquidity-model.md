# Trust & Liquidity Model (Version 1.0)
**Date:** August 30, 2026

This document represents the finalized Trust & Liquidity Model for the Invoice Liquidity Network, explicitly addressing the reviewer feedback from the initial internal design phase. It serves as a permanent, versioned public record of our architectural decisions.

## Reviewer Feedback & Final Decisions

### 1. Target Market Focus
- **Reviewer Question**: The initial draft was too broad regarding the target market. Who are the initial borrowers and what is the specific geographic focus?
- **Final Decision**: We are exclusively targeting SME suppliers based in emerging markets (primarily LATAM and Southeast Asia) interacting with US-based enterprise buyers. This minimizes currency volatility risk on the buyer side while maximizing the impact of early liquidity for suppliers.

### 2. KYB Provider Integration
- **Reviewer Question**: How will business identity and corporate risk be assessed at scale without bottlenecking liquidity?
- **Final Decision**: We will integrate with an established, regulated external KYB provider. Their API provides the necessary corporate structure unrolling and ultimate beneficial owner (UBO) verification required by our initial Liquidity Providers, without storing sensitive PII natively on our infrastructure (see [Privacy Policy](./privacy.md)).

#### 2.1 Provider Unavailability

KYB is a required onboarding control for business borrowers; provider unavailability never counts as a pass. The oracle uses a **temporary hard block with caller-driven retry**: if the required KYB adapter is missing or throws/times out, the verification response is not approved and carries the `rejected-kyb-unavailable` outcome. The borrower remains unapproved and cannot proceed to liquidity onboarding until a successful provider result is available. Provider rejection remains a distinct negative verification result: it carries the `rejected-kyb-unverified` outcome and the `PAYER_KYB_UNVERIFIED` code, while unavailability carries `PAYER_KYB_UNAVAILABLE` (see [Payer Authorization Failures Runbook](runbooks/payer-authorization-failures.md)).

The service does not silently fall back to heuristic-only approval, and there is no manual-review override in this contract. Callers should retry after provider health recovers, using bounded backoff. Production oracle wiring requires a live KYB result for approval and bypasses cached verdicts while this check is required; local/test deployments can explicitly opt into non-required KYB for fixtures only. Production boot additionally refuses to start without an explicit, required, non-mock KYB adapter, every publication records KYB provider provenance (`kybProvenance`), and a recorded decision expires after `ORACLE_KYB_DECISION_TTL_MS` (default 24h) and is revalidated against the provider rather than replayed (see [Oracle Service](oracle-service.md)). A manual review route, if introduced later, must preserve the same KYB requirement and be separately approved and audited.

### 3. LP Cold-Start Posture
- **Reviewer Question**: How do we guarantee initial liquidity before a proven track record is established?
- **Final Decision**: We will deploy a "First-Loss Provision" managed via a dedicated treasury multi-sig during the cold-start phase. This provides a buffer for external LPs, ensuring that the first 5% of any default is absorbed by the protocol's treasury, drastically lowering the risk threshold for onboarding initial institutional capital.

### 4. Settlement Anchor Partner
- **Reviewer Question**: Which fiat-on/off ramp will handle the final mile settlement, and what are their SLA guarantees?
- **Final Decision**: We have selected regulated stablecoin issuers (like Circle for USDC) combined with Stellar Anchor Network members for local currency disbursement. This dual-anchor strategy guarantees near-instant USD-equivalent settlement while providing localized rails for SMEs who prefer native fiat.

#### 4.1 Sanctions screening integration point (pre-mainnet gate)

Screening is an off-chain compliance gate owned jointly by ILN's compliance
operator and the selected settlement-anchor partner. Before an account can
request an anchor deposit or payout, the onboarding service submits the
minimum partner-required identity data plus the Stellar public address,
transaction direction, asset, amount, and jurisdiction to the partner's
sanctions-screening interface. ILN does not select a screening vendor or claim
that screening is currently integrated; the partner contract and API schema
must define the exact identity fields, lawful basis, retention, and permitted
use before production credentials are enabled.

The screening adapter returns a case reference and one of `clear`, `potential_match`,
or `unavailable`. Only `clear` may proceed. A potential match places the
settlement request on compliance hold: no fiat instruction is sent and no
on-chain settlement action is initiated by the integration. An unavailable,
timed-out, malformed, or indeterminate response also fails closed and remains
on hold; bounded retries use an idempotency key derived from the ILN request
ID. Repeated failures page the operator and leave the request pending rather
than treating the outage as approval.

The operator reviews potential matches through the partner's documented
case-resolution channel. A false-positive release requires a recorded,
authorized partner decision and case reference; ILN operators cannot override
the screening result. The user receives a generic pending-review status that
does not disclose list data. Appeals follow the partner's published process.
Record the decision, timestamp, reviewer/partner case reference, and outcome,
but do not copy raw watchlist results into ILN logs. KYB and sanctions checks
share the same compliance-hold state and fail-closed user experience, while
remaining separate decisions. Mainnet launch is blocked until the partner
interface, ownership, escalation SLA, retention terms, and end-to-end tests
are approved and documented.

---

## 5. Settlement-Anchor Partner Failure & Insolvency Analysis

This section analyzes protocol exposure, failure modes, and recovery paths in the event that a settlement-anchor partner experiences either a temporary operational outage or a permanent insolvency event.

### 5.1 Scenario Classification & Risk Exposure

| Failure Scenario | Root Cause | Impacted Phase | User Fund Exposure | Protocol Response / Fallback |
|---|---|---|---|---|
| **Temporary Outage** | API downtime, SEP-24/SEP-31 endpoint failure, banking window delays | In-flight payout or deposit | Zero capital loss; temporary delay in fiat payout | Automatic transaction timeout revert; retry via secondary Stellar anchor |
| **Anchor Insolvency** | Anchor bankruptcy, regulatory seizure, loss of fiat reserve backing | Fiat off-ramp holding reserves | On-chain Soroban funds remain safe; unredeemed fiat vouchers at risk | Multi-anchor diversification, on-chain circuit breakers, treasury insurance buffer |

### 5.2 Recourse & Fallback Mechanics

1. **Smart Contract Escrow Safety**:
   - Soroban smart contract escrow funds are non-custodial and locked against on-chain conditions. Anchor downtime does not allow unauthorized withdrawal of on-chain collateral or LP funds.
2. **Timelocked Auto-Revert**:
   - If an anchor fails to confirm fiat delivery within the designated SEP-24 completion window (default: 24 hours), the smart contract state machine allows the borrower or funder to trigger an automated timelocked cancellation, releasing locked assets back to the original caller.
3. **Multi-Anchor Fallback Routing**:
   - The protocol client maintains a registry of active SEP-compliant Stellar anchors per geographic jurisdiction. When an anchor endpoint fails health checks or exceeds error thresholds, client routing automatically shifts new off-ramp volume to alternative secondary anchors.

### 5.3 Protocol Mitigations & Risk Controls

- **Anchor Diversification**: The protocol requires at least two independent Stellar Anchor Network partners per supported currency corridor (e.g., LATAM BRL/MXN, SEA IDR/PHP).
- **Automated Circuit Breakers**: If an anchor's error rate exceeds 5% over a 15-minute sliding window, the protocol automatically pauses new settlement assignments to that anchor.
- **Treasury First-Loss Protection**: In the event of a catastrophic anchor insolvency impacting in-transit user funds, the protocol's First-Loss Provision treasury buffer absorbs verified losses up to the defined cap before LP principal is impacted.

---
*These decisions mark the conclusion of the Trust & Liquidity Model design phase and govern the v1 mainnet deployment.*

## 6. Simultaneous LP Withdrawal Stress Analysis

### 6.1 Scope and current design boundary

The invoice contract reference describes LP capital as funding individual invoices, supports partial funding, and describes an LP priority queue. It does not define a pooled-share redemption API, withdrawal notice period, withdrawal queue, or guarantee that an LP can redeem capital committed to an unpaid invoice. This analysis therefore stress-tests a **hypothetical pooled deployment**, not a claim that the current contract implements pool withdrawals. Capital committed to an invoice is treated as locked until repayment or another contract-defined terminal outcome; only uncommitted cash is immediately liquid.

The 5% treasury first-loss provision covers a defined slice of credit losses on defaults. It is not a liquidity reserve and does not make locked invoice capital available during a withdrawal run.

### 6.2 Normalized simultaneous-withdrawal model

Assume a pool has 100 units of LP capital immediately before a panic. 60 units are committed to invoices and cannot be redeemed immediately; 40 units are idle cash. There are no repayments, asset sales, or new deposits during the withdrawal window. LPs submit withdrawal requests simultaneously, sized as a share of total pool capital.

| Requested withdrawals | Request size | Immediately payable from 40 idle units | Remaining queued/unpaid | Immediate fulfillment |
|---|---:|---:|---:|---:|
| 25% severity | 25 | 25 | 0 | 100% |
| 50% severity | 50 | 40 | 10 | 80% |
| 75% severity | 75 | 40 | 35 | 53.3% |
| 90% severity | 90 | 40 | 50 | 44.4% |

The figures are a deterministic liquidity-accounting example, not a forecast. They exclude defaults, fees, token depegs, and secondary-market sales. If requests are fulfilled first-come-first-served rather than pro rata, early callers can receive all 40 liquid units and late callers can receive nothing, even when request sizes are equal.

### 6.3 Failure mode and proposed controls

There is no documented orderly redemption path in the current design boundary. A pooled implementation that promises synchronous, full redemption would hit a **liquidity cliff** once aggregate requests exceed idle cash (40% in this example). Partial or delayed withdrawals can degrade orderly only if queueing, priority, and repayment allocation are specified in advance. This does not imply that an invoice defaults: it means the LP cannot exit on demand while capital remains committed.

Before introducing pooled LP shares, the contract design should specify:

1. **Epoch-based withdrawal queue:** batch requests at a published cutoff and satisfy them pro rata from available cash and realized repayments. Carry unpaid amounts forward without giving transaction-order priority; disclose that locked capital is not immediately redeemable.
2. **Funding circuit breaker:** pause new invoice deployment when liquid assets fall below an explicitly governed threshold or queued withdrawals exceed available cash. A pause protects remaining liquidity from additional commitments; it does not create cash or cancel existing obligations.
3. **Liquidity-aware pricing:** consider an utilization premium for *new* funding only if simulations show it attracts replacement liquidity without making borrower pricing pathological. Fees cannot solve an immediate run and should not be described as a redemption guarantee.
4. **Run disclosures and monitoring:** publish liquid/committed/queued balances, queue age, and repayment assumptions, and test recovery as invoices repay under base and stressed default assumptions.

These are design recommendations, not deployed protections. The applicable Soroban implementation is maintained in the separate [smart-contract repository](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract); no withdrawal logic is claimed here until that implementation defines and tests it.

---

## 7. Withdrawal Queue Specification for Pooled LP Shares

This section formally specifies the withdrawal queue behavior, notice periods, and queue state model for pooled LP share redemptions. This specification governs the Soroban implementation in the ILN-Smart-Contract repository and must be implemented and tested before pooled LP shares are deployed.

### 7.1 Design Principles

1. **No synchronous full redemption**: The protocol does not guarantee immediate redemption of capital committed to invoices. Locked capital becomes available only as invoices repay or reach terminal states.
2. **Pro rata fairness**: Within each epoch, all queued withdrawal requests are satisfied proportionally from available liquidity; no transaction-order priority.
3. **Fail-closed liquidity protection**: New invoice funding pauses automatically when queued withdrawals exceed available liquid assets.
4. **Transparent disclosure**: Real-time publication of liquid/committed/queued balances, queue age, and repayment assumptions.
5. **Operator-observable state**: Every queue state transition emits an on-chain event and is indexed for monitoring.

### 7.2 Withdrawal Notice Period

| Parameter | Value | Description |
|-----------|-------|-------------|
| `NOTICE_PERIOD_EPOCHS` | 1 | Minimum number of epochs between withdrawal request submission and eligibility for processing. A request submitted in epoch N becomes eligible in epoch N+1. |
| `EPOCH_DURATION_DAYS` | 7 | Length of each withdrawal epoch. Aligns with typical invoice repayment cycles. |
| `MAX_NOTICE_EPOCHS` | 4 | Maximum notice period an LP can specify (4 epochs = 28 days). Requests with longer notice are capped at this value. |

**Invariant**: A withdrawal request cannot be processed in the same epoch it is submitted. This prevents last-minute queue manipulation and ensures the protocol has visibility into pending outflows before committing new capital.

### 7.3 Withdrawal Request State Machine

Each withdrawal request transitions through the following states. All transitions are recorded on-chain with timestamps and emitted as indexable events.

```
┌─────────────┐     submit      ┌──────────┐   epoch cutoff    ┌──────────┐
│  PENDING    │ ──────────────▶ │  QUEUED  │ ────────────────▶ │ PROCESSING │
│ (submitted) │                 │ (eligible)│                   │ (settling) │
└─────────────┘                 └──────────┘                   └──────┬─────┘
      │                            │                                  │
      │ cancel (LP)                │ cancel (LP)                      │
      ▼                            ▼                                  ▼
┌─────────────┐                ┌──────────┐                    ┌─────────────┐
│  CANCELLED  │                │  CANCELLED │                │  COMPLETED  │
│  (by LP)    │                │  (by LP)   │                │  (paid out) │
└─────────────┘                └──────────┘                    └─────────────┘
                                                                      │
                                                           partial fill │
                                                                      ▼
                                                             ┌─────────────┐
                                                             │  PARTIAL    │
                                                             │  (re-queued)│
                                                             └─────────────┘
```

**State Definitions:**

| State | Description | Terminal? |
|-------|-------------|-----------|
| `PENDING` | Request submitted but not yet eligible (within notice period). LP may cancel. | No |
| `QUEUED` | Request eligible for processing in current or future epoch. LP may cancel. | No |
| `PROCESSING` | Request being settled in current epoch. No cancellation allowed. | No |
| `COMPLETED` | Request fully paid out. | Yes |
| `PARTIAL` | Request partially filled; remainder re-queued for next epoch with same priority. | No |
| `CANCELLED` | Request cancelled by LP before processing. | Yes |

**Transition Rules:**

1. `PENDING` → `QUEUED`: Automatic at epoch boundary when `current_epoch >= request_epoch + NOTICE_PERIOD_EPOCHS`.
2. `QUEUED` → `PROCESSING`: Automatic at epoch processing cutoff for all eligible requests.
3. `PROCESSING` → `COMPLETED`: When full requested amount is paid from available liquidity.
4. `PROCESSING` → `PARTIAL`: When available liquidity < requested amount. Paid portion moves to `COMPLETED`; remainder stays `QUEUED` for next epoch.
5. `PENDING` → `CANCELLED` / `QUEUED` → `CANCELLED`: LP-initiated at any time before `PROCESSING`.
6. `PARTIAL` → `QUEUED`: Automatic at next epoch boundary (remainder retains original submission timestamp for priority).

### 7.4 Epoch Processing Algorithm

At each epoch cutoff (every `EPOCH_DURATION_DAYS`):

1. **Snapshot**: Record `available_liquidity = idle_cash + projected_repayments_this_epoch - reserved_for_pending_invoices`.
2. **Collect eligible requests**: All requests in `QUEUED` state with `eligible_epoch <= current_epoch`.
3. **Sort by submission timestamp**: FIFO within same epoch; earlier submissions get priority if pro rata cannot satisfy all.
4. **Pro rata allocation**: For each request in order:
   - `allocation = min(request.remaining_amount, request.remaining_amount * available_liquidity / total_queued_amount)`
   - If `allocation == request.remaining_amount`: transition to `COMPLETED`.
   - Else: transition to `PARTIAL` (remainder re-queued).
   - `available_liquidity -= allocation`
   - `total_queued_amount -= request.remaining_amount`
5. **Emit events**: `WithdrawalEpochProcessed` with epoch number, total requested, total paid, number of partial fills.
6. **Advance epoch**: Increment epoch counter; move `PENDING` requests meeting notice period to `QUEUED`.

**Invariant**: `sum(allocation) <= available_liquidity` at all times. The protocol never over-commits liquidity.

### 7.5 Illiquid Position Handling

An "illiquid position" is LP capital committed to invoices that have not yet reached a terminal state (repayment, default, or restructuring). This capital is **not** part of `available_liquidity` and cannot be used to satisfy withdrawal requests.

| Position Type | Included in `available_liquidity`? | Withdrawable? |
|---------------|-----------------------------------|---------------|
| Idle cash (uncommitted) | Yes | Immediately (subject to notice period) |
| Projected repayments (next epoch) | Yes, as `projected_repayments_this_epoch` | In the epoch they are projected |
| Committed to active invoices | No | Only as invoices repay |
| Committed to defaulted invoices | No | Only after default resolution (recovery or write-off) |
| First-loss treasury buffer | No (separate accounting) | Never — not LP capital |

**Illiquid Position Disclosure**: The protocol publishes daily:
- `total_committed`: Capital locked in active invoices
- `total_queued_withdrawals`: Sum of all `QUEUED` and `PARTIAL` request amounts
- `liquidity_coverage_ratio = available_liquidity / total_queued_withdrawals` (capped at 1.0)
- `oldest_queued_request_age`: Days since oldest `QUEUED` request submission

### 7.6 Funding Circuit Breaker

The protocol automatically pauses new invoice deployment when liquidity conditions deteriorate:

| Trigger | Condition | Action |
|---------|-----------|--------|
| **Liquidity threshold breach** | `available_liquidity < LIQUIDITY_FLOOR` (governed parameter, default 10% of pool TVL) | Pause new invoice deployment |
| **Queue overflow** | `total_queued_withdrawals > available_liquidity * QUEUE_COVERAGE_LIMIT` (default 2.0x) | Pause new invoice deployment |
| **Concentration risk** | Single LP's queued withdrawals > `SINGLE_LP_QUEUE_CAP` (default 25% of pool TVL) | Pause new invoice deployment for that LP's capital |

**Recovery**: The pause lifts automatically when all trigger conditions are false for `PAUSE_COOLDOWN_EPOCHS` (default 2 epochs). Manual override requires multi-sig approval from Protocol lead + Security lead.

### 7.7 Queue State Model Implementation Requirements

The Soroban contract must implement the following for each withdrawal request:

```rust
pub struct WithdrawalRequest {
    pub request_id: u64,
    pub lp_address: Address,
    pub pool_id: u64,
    pub requested_amount: i128,
    pub remaining_amount: i128,
    pub submitted_epoch: u64,
    pub notice_epochs: u8, // 1..=MAX_NOTICE_EPOCHS
    pub state: WithdrawalState,
    pub created_at: u64, // ledger timestamp
    pub updated_at: u64,
    pub paid_epochs: Vec<u64>, // epochs where partial fills occurred
}

pub enum WithdrawalState {
    Pending,
    Queued,
    Processing,
    Completed,
    Partial,
    Cancelled,
}
```

**Required contract methods:**
- `submit_withdrawal(lp, pool_id, amount, notice_epochs)` → `request_id`
- `cancel_withdrawal(request_id)` → `bool` (only in `Pending` or `Queued`)
- `process_epoch()` → `EpochResult` (callable by anyone at epoch boundary)
- `get_request(request_id)` → `WithdrawalRequest`
- `get_pool_queue_state(pool_id)` → `PoolQueueState` (aggregate metrics)

**Required events:**
- `WithdrawalSubmitted { request_id, lp, amount, epoch, notice_epochs }`
- `WithdrawalCancelled { request_id, lp, remaining_amount }`
- `WithdrawalProcessed { request_id, lp, paid_amount, epoch, final_state }`
- `WithdrawalEpochProcessed { epoch, total_requested, total_paid, partial_count }`
- `CircuitBreakerTriggered { pool_id, trigger_type, threshold_value }`
- `CircuitBreakerCleared { pool_id }`

### 7.8 Monitoring and Runbook References

| Metric / Alert | Threshold | Runbook |
|----------------|-----------|---------|
| `liquidity_coverage_ratio` | < 0.5 for 2 consecutive epochs | [Liquidity Crisis Runbook](runbooks/liquidity-crisis.md) |
| `oldest_queued_request_age` | > 28 days | [Stale Withdrawal Investigation](runbooks/stale-withdrawal.md) |
| `circuit_breaker_active` | Any trigger active | [Funding Pause Response](runbooks/funding-pause.md) |
| `partial_fill_rate` | > 50% of requests in epoch | [Partial Fill Analysis](runbooks/partial-fill-analysis.md) |

### 7.9 Governance Parameters

All parameters below are governed by the Protocol multi-sig and can be updated via on-chain governance proposal:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `EPOCH_DURATION_DAYS` | 7 | Length of withdrawal processing epoch |
| `NOTICE_PERIOD_EPOCHS` | 1 | Minimum epochs between submission and eligibility |
| `MAX_NOTICE_EPOCHS` | 4 | Maximum notice period an LP can specify |
| `LIQUIDITY_FLOOR` | 10% of pool TVL | Minimum available liquidity before funding pause |
| `QUEUE_COVERAGE_LIMIT` | 2.0x | Max ratio of queued withdrawals to available liquidity |
| `SINGLE_LP_QUEUE_CAP` | 25% of pool TVL | Max single LP exposure in queue |
| `PAUSE_COOLDOWN_EPOCHS` | 2 | Epochs conditions must be clear before auto-resume |

---

*This specification (Section 7) is a binding design document for the ILN-Smart-Contract implementation. The smart contract code must conform to this specification and pass the corresponding integration tests before pooled LP shares are deployed to mainnet.*

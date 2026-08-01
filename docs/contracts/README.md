# Smart Contract Reference Guide

Complete reference documentation for the Invoice Liquidity Network (ILN) smart contracts. These documents provide developers with all function signatures, parameters, return values, error conditions, and examples needed to integrate with ILN.

---

## Contract Overview

The ILN system consists of three main smart contracts deployed on Stellar:

| Contract | Purpose | Language |
|----------|---------|----------|
| **Invoice Liquidity** | Core escrow, invoices, funding | Rust (Soroban) |
| **Governance** | Proposals, voting, delegation | Rust (Soroban) |
| **Reputation Bonus** | Reputation scoring, discount bonuses | Rust (Soroban) |

---

## Quick Reference by Use Case

### I want to... 

**Submit an invoice for funding**
- Read: [Invoice Contract](./invoice-contract.md#submit_invoice)
- Function: `submit_invoice(freelancer, payer, amount, due_date, discount_rate, token)`
- Example: Freelancer creates invoice, LPs can fund it

**Fund an invoice (as an LP)**
- Read: [Invoice Contract](./invoice-contract.md#fund_invoice)
- Function: `fund_invoice(funder, invoice_id, fund_amount, require_oracle_verification?)`
- Example: LP contributes capital to earn discount rate

**Query my invoices**
- Read: [Invoice Contract](./invoice-contract.md#list_invoices_by_submitter)
- Function: `list_invoices_by_submitter(submitter, page, page_size)`
- Example: Get paginated list of submitted invoices

**Check my reputation score**
- Read: [Invoice Contract](./invoice-contract.md#get_reputation)
- Function: `get_reputation(address)`
- Example: Payer views reputation & payment history

**Vote on a governance proposal**
- Read: [Governance Contract](./governance-contract.md#cast_vote)
- Function: `cast_vote(voter, proposal_id, support)`
- Example: Token holder votes for/against parameter change

**Create a governance proposal**
- Read: [Governance Contract](./governance-contract.md#create_proposal)
- Function: `create_proposal(proposer, action_type, description_hash, proposed_value)`
- Example: Propose fee rate update

**Delegate voting power**
- Read: [Governance Contract](./governance-contract.md#delegate_votes)
- Function: `delegate_votes(delegator, delegate)`
- Example: Delegate voting power to trusted party

---

## Contracts by Function Category

### Invoice Lifecycle

**Submission & Modification**
- [submit_invoice](./invoice-contract.md#submit_invoice) - Create new invoice
- [submit_invoice_auction](./invoice-contract.md#submit_invoice_auction) - Create Dutch auction
- [update_invoice](./invoice-contract.md#update_invoice-access-submitter-only) - Update pending invoice
- [convert_invoice_token](./invoice-contract.md#convert_invoice_token-access-submitter-only) - Change payment token
- [transfer_invoice](./invoice-contract.md#transfer_invoice-access-submitter-only) - Transfer to new recipient
- [submit_invoices_batch](./invoice-contract.md#submit_invoices_batch-access-submitter-only) - Bulk submission

**Funding**
- [fund_invoice](./invoice-contract.md#fund_invoice) - Contribute capital
- [join_fund_queue](./invoice-contract.md#join_fund_queue) - Register for priority queue
- [resolve_fund_queue](./invoice-contract.md#resolve_fund_queue) - Select approved LP
- [transfer_lp_position](./invoice-contract.md#transfer_lp_position) - Transfer LP claim

**Settlement & Default**
- [mark_paid](./invoice-contract.md#mark_paid) - Record payment
- [claim_default](./invoice-contract.md#claim_default) - Claim LP refund after default
- [claim_yield](./invoice-contract.md#claim_yield-access-lp-only) - Query LP earnings

**Disputes & Appeals**
- [dispute_invoice](./invoice-contract.md#dispute_invoice) - Contest before settlement
- [resolve_dispute](./invoice-contract.md#resolve_dispute) - Admin ruling
- [appeal_default](./invoice-contract.md#appeal_default) - Contest default
- [resolve_appeal](./invoice-contract.md#resolve_appeal) - Admin appeals decision

**Query**
- [get_invoice](./invoice-contract.md#get_invoice) - Retrieve invoice details
- [list_invoices_by_submitter](./invoice-contract.md#list_invoices_by_submitter) - Paginated submitter invoices
- [list_invoices_by_lp](./invoice-contract.md#list_invoices_by_lp) - Paginated LP invoices
- [get_invoice_count](./invoice-contract.md#get_invoice_count) - Count (total or by status)
- [get_contract_stats](./invoice-contract.md#get_contract_stats) - Contract-wide analytics

---

### Reputation & Scoring

**Reputation Query**
- [get_reputation](./invoice-contract.md#get_reputation) - Fetch reputation profile
- [payer_score](./invoice-contract.md#payer_score) - Get payer score
- [lp_score](./invoice-contract.md#lp_score) - Get LP score
- [get_top_payers](./invoice-contract.md#get_top_payers-issue-77) - Highest reputation payers
- [suggested_discount_rate](./invoice-contract.md#suggested_discount_rate) - Score-based rate suggestion

**LP Analytics**
- [get_lp_portfolio_stats](./invoice-contract.md#get_lp_portfolio_stats) - LP yield analytics
- [min_payer_reputation](./invoice-contract.md#min_payer_reputation) - Minimum payer score

**Reputation Contracts**
- [Reputation Contract Reference](./reputation-contract.md) - Full reputation system
- [get_reputation](./reputation-contract.md#get_reputation) - Query reputation profile
- [submit_invoice](./reputation-contract.md#submit_invoice) - Calculate reputation-adjusted discount

---

### Governance & Administration

**Proposals**
- [create_proposal](./governance-contract.md#create_proposal) - Submit governance proposal
- [get_proposal](./governance-contract.md#get_proposal) - Fetch proposal details
- [list_proposals](./governance-contract.md#list_proposals) - Paginated proposal list
- [execute_proposal](./governance-contract.md#execute_proposal) - Execute approved proposal

**Voting**
- [cast_vote](./governance-contract.md#cast_vote) - Vote on proposal
- [has_voted](./governance-contract.md#has_voted) - Check voting status

**Delegation**
- [delegate_votes](./governance-contract.md#delegate_votes) - Delegate voting power
- [undelegate_votes](./governance-contract.md#undelegate_votes) - Revoke delegation
- [get_delegate](./governance-contract.md#get_delegate) - Query direct delegate

**Admin**
- [set_admin](./invoice-contract.md#set_admin) - Transfer admin privileges
- [veto_proposal](./governance-contract.md#veto_proposal) - Emergency block proposal
- [disable_veto_power](./governance-contract.md#disable_veto_power) - Governance can disable veto
- [pause](./invoice-contract.md#pause--unpause) / [unpause](./invoice-contract.md#pause--unpause) - Emergency pause

**Configuration**
- [update_fee_rate](./invoice-contract.md#update_fee_rate) - Set protocol fee
- [update_protocol_fee_bps](./invoice-contract.md#update_protocol_fee_bps) - Set LP earnings fee
- [update_max_discount](./invoice-contract.md#update_max_discount-access-admin-only) - Set max LP yield
- [add_token](./invoice-contract.md#add_token) - Approve token
- [remove_token](./invoice-contract.md#remove_token) - Disable token
- [set_min_payer_reputation](./invoice-contract.md#set_min_payer_reputation) - Minimum payer score gate
- [set_min_quorum_bps](./governance-contract.md#set_min_quorum_bps) - Quorum requirement
- [set_execution_delay](./governance-contract.md#set_execution_delay) - Timelock delay

**Multi-Sig**
- [initialize_multisig_admin](./invoice-contract.md#initialize_multisig_admin) - Set up multi-signature
- [propose_pause](./invoice-contract.md#propose_pause--propose_unpause) - Multi-sig propose pause
- [sign_proposal](./invoice-contract.md#sign_proposal) - Add multi-sig signature
- [execute_proposal](./invoice-contract.md#execute_proposal-1) - Execute multi-sig proposal

---

## Data Structures

### Core Types

**Invoice**
- [Reference](./invoice-contract.md#invoice-structure)
- All invoice data: parties, amounts, dates, status
- Includes optional auction fields, LP whitelist, reputation snapshot

**ReputationProfile**
- [Reference](./invoice-contract.md#reputationprofile)
- Score, counters (submitted/paid/defaulted), activity timestamp

**LPStats**
- [Reference](./invoice-contract.md#lpstats)
- Aggregated portfolio metrics: total_funded, total_earned, active positions, average yield

**GovernanceProposal**
- [Reference](./governance-contract.md#governanceproposal)
- Proposal id, proposer, action, votes, status, timelock info

**ProposalAction**
- [Reference](./governance-contract.md#proposalaction)
- Variants: UpdateFeeRate, AddToken, RemoveToken, UpdateMaxDiscountRate

**ProposalStatus**
- [Reference](./governance-contract.md#proposalstatus)
- Active, Passed, Rejected, Executed, Vetoed

---

## Event Schema

### Invoice Events

- `InvoiceSubmitted` - Invoice created
- `InvoiceFunded` - Successfully funded (individual funding)
- `InvoicePartiallyPaid` - Partial payment recorded
- `InvoicePaid` - Fully settled
- `InvoiceDefaulted` - Unpaid past due date
- `InvoiceExpired` - Never funded, due date passed
- `InvoiceCancelled` - Submitter cancelled
- `InvoiceUpdated` - Terms modified
- `InvoiceTransferred` - Transferred to new recipient
- `InvoiceTokenChanged` - Payment token changed
- `InvoiceDisputed` - Payer contested
- `InvoiceAppealed` - Appeal filed against default
- `DefaultAppealed` - Appeal filed
- `AppealResolved` - Appeal decision rendered

### Auction Events

- `AuctionStarted` - Dutch auction created
- `AuctionFunded` - Funding during auction with effective rate

### Reputation Events

- `ReputationUpdated` - Score changed
- `PayerReputationDecayed` - Time-based decay applied

### Governance Events

- `ProposalCreated` - Proposal submitted
- `VoteCast` - Vote recorded
- `VotesDelegated` - Delegation created
- `VotesUndelegated` - Delegation revoked
- `ProposalExecuted` - Proposal action executed
- `ProposalVetoed` - Admin blocked proposal

### Admin Events

- `AdminChanged` - New admin set
- `TokenAdded` - Token approved
- `TokenRemoved` - Token disabled
- `ParameterUpdated` - Config changed
- `ContractPaused` / `ContractUnpaused` - Pause state toggled
- `ContractUpgraded` - WASM upgraded

---

## Error Codes Reference

**Common Errors**
- `Unauthorized` - Caller not authorized
- `ContractPaused` - Contract in emergency pause state

**Invoice Errors** ([full list](./invoice-contract.md#error-codes))
- `InvoiceNotFound` - Invalid invoice ID
- `AlreadyFunded` - Invoice fully funded
- `NotFunded` - Invoice not yet funded
- `InvalidDueDate` - Date outside valid range
- `PayerReputationTooLow` - Payer below minimum score
- `LPNotWhitelisted` - LP not in allowed list

**Governance Errors** ([full list](./governance-contract.md#error-codes))
- `ProposalNotFound` - Invalid proposal ID
- `VotingEnded` - Voting period closed
- `AlreadyVoted` - Voter already voted
- `QuorumNotReached` - Insufficient participation
- `DelegationCyclePrevented` - Would create delegation loop

---

## Integration Patterns

### SDK Usage

TypeScript SDK client examples:

```typescript
import { ILNClient } from '@iln/sdk';

const client = new ILNClient({
  rpc: 'https://soroban-testnet.stellar.org',
  invoiceContractId: 'CD3TE3IAHM...',
});

// Submit invoice
const invoiceId = await client.submitInvoice({
  freelancer: freelancerAddress,
  payer: payerAddress,
  amount: BigInt('10000000'),
  dueDate: futureTimestamp,
  discountRate: 300,
  token: usdcAddress,
});

// Fund invoice
await client.fundInvoice({
  funder: lpAddress,
  invoiceId: invoiceId,
  fundAmount: BigInt('5000000'),
});
```

See: [Integration Guide](../integration-guide.md)

### Event Listening

Listen to contract events:

```typescript
// Listen for InvoicePaid events
const subscription = client.on('InvoicePaid', (event) => {
  console.log('Invoice paid:', event.invoice_id);
  console.log('LP earned:', event.lp_earned);
});
```

See: [Event Documentation](#event-schema)

### Governance Workflow

Typical governance proposal flow:

1. Propose: Create proposal via governance contract
2. Vote: Members vote during 3-day period
3. Execute: After voting ends + timelock, execute proposal
4. Effect: Proposal action executes on ILN contract

See: [Governance Contract - Workflow Example](./governance-contract.md#workflow-example-create--execute-a-proposal)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│         Stellar Blockchain (Soroban)            │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  Invoice Liquidity Contract              │  │
│  │  • Invoice lifecycle                    │  │
│  │  • Funding & settlement                 │  │
│  │  • Disputes & appeals                   │  │
│  │  • Reputation scoring                   │  │
│  │  • Batch operations                     │  │
│  └──────────┬──────────────────────────────┘  │
│             │ executes via governance         │
│             ▼                                  │
│  ┌──────────────────────────────────────────┐  │
│  │  Governance Contract                    │  │
│  │  • Proposal creation & voting           │  │
│  │  • Vote delegation (transitive)         │  │
│  │  • Timelock & execution                 │  │
│  │  • Admin veto (optional)                │  │
│  └──────────────────────────────────────────┘  │
│             ▲                                  │
│             │ updates config                  │
│             │                                  │
│  ┌──────────────────────────────────────────┐  │
│  │  Reputation Bonus Contract              │  │
│  │  • Reputation calculation               │  │
│  │  • Discount bonus computation           │  │
│  │  • Lifecycle hooks (submit/paid/default)│  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  + Tokens (USDC, XLM, EURC SACs)               │
│  + Optional: Price Oracle, Distribution Hooks  │
│                                                 │
└─────────────────────────────────────────────────┘
         │
         │ Web3 SDK
         ▼
┌─────────────────────────────────┐
│  Frontend / Backend Integration │
│  • Mobile app                   │
│  • Web dashboard                │
│  • API server                   │
│  • Notification service         │
└─────────────────────────────────┘
```

---

## Testnet Deployment

| Component | Address | Notes |
|-----------|---------|-------|
| Invoice Contract | `CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC` | Core contract |
| USDC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | Test USDC |
| RPC | `https://soroban-testnet.stellar.org` | Stellar test network |

---

## Next Steps

1. **Read the appropriate contract reference** based on your use case:
   - [Invoice Liquidity Contract](./invoice-contract.md) - For invoice operations
   - [Governance Contract](./governance-contract.md) - For governance & voting
   - [Reputation Contract](./reputation-contract.md) - For reputation system

2. **Follow the Integration Guide** to set up SDK and start coding:
   - [Integration & SDK Usage](../integration-guide.md)

3. **Monitor events** for real-time updates:
   - [Event Schema Documentation](#event-schema)

4. **Review examples** in the repository:
   - TypeScript SDK: [`sdk/src/`](../../sdk/src/)
   - CLI: [`cli/src/`](../../cli/src/)
   - Integration tests: [`tests/`](../../tests/)

---

## Support & Resources

- **GitHub Repository**: [ILN Smart Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract)
- **Documentation**: This docs site
- **Integration Guide**: [How to integrate](../integration-guide.md)
- **Event Reference**: [Event schema](#event-schema)
- **Local Development**: [Local setup](../local-development.md)

---

## Glossary

- **Invoice** - A billing claim from freelancer to payer
- **LP** (Liquidity Provider) - Provides capital to fund invoices
- **Funder** - Alternative term for LP in context of specific invoice
- **Discount Rate** - LP yield in basis points (bps)
- **Reputation Score** - Account's reliability metric (0-100+)
- **Stroops** - Smallest unit (10^-7 USDC)
- **Quorum** - Minimum participation for governance (bps of total supply)
- **Timelock** - Delay before proposal execution (ledgers)
- **Delegation** - Transfer of voting power to another account
- **Default** - Unpaid invoice after due date
- **Appeal** - Payer contest of default marking
- **Dispute** - Payer contest before settlement

---

## TypeScript Type Alignment (`packages/shared`)

### The drift problem

`packages/shared/src/types.ts` is the foundation every TypeScript consumer
builds on. Before the audit in July 2026, the hand-maintained types had
drifted significantly from the deployed contract. The table below records
every finding so future auditors can verify the fix and catch new drift early.

### Drift found and fixed (July 2026 audit)

#### `InvoiceStatus` (was `InvoiceState`)

| Value | Was present | Notes |
|---|---|---|
| `Pending` | ✅ | |
| `PartiallyFunded` | ❌ missing | Added |
| `Funded` | ✅ | |
| `Paid` | ✅ | |
| `Defaulted` | ✅ | |
| `Appealed` | ❌ missing | Added |
| `Disputed` | ❌ missing | Added |
| `Expired` | ❌ missing | Added |
| `Cancelled` | ❌ missing | Added |

`InvoiceState` kept as a deprecated alias for backward compatibility.

#### `Invoice` struct

| Field | Was present | Fix |
|---|---|---|
| `id`, `freelancer`, `payer`, `amount`, `dueDate`, `discountRate`, `status`, `funder`, `fundedAt` | ✅ | — |
| `token` | ❌ missing | Added — payment token address (USDC/XLM/EURC) |
| `amountFunded` | ❌ missing | Added — cumulative LP capital deployed |
| `amountPaid` | ❌ missing | Added — cumulative payer payments |
| `submitterReputation` | ❌ missing | Added — freelancer score snapshot at submission |
| `referralCode` | ❌ missing | Added — `Uint8Array \| null` (BytesN<32>) |
| `allowedLps` | ❌ missing | Added — LP whitelist (`string[] \| null`) |
| `isAuction` | ❌ missing | Added |
| `auctionStartRate` | ❌ missing | Added |
| `auctionMinRate` | ❌ missing | Added |
| `auctionRateDecayPerHour` | ❌ missing | Added |
| `auctionStartedAt` | ❌ missing | Added |

#### `ReputationScore`

| Field | Was present | Fix |
|---|---|---|
| `address`, `score` | ✅ | — |
| `updatedAt` | ❌ wrong name | Renamed to `lastActivityLedger` (maps to `last_activity_ledger u64`) |
| `invoicesSubmitted` | ❌ missing | Added (`invoices_submitted u64`) |
| `invoicesPaid` | ❌ missing | Added (`invoices_paid u64`) |
| `invoicesDefaulted` | ❌ missing | Added (`invoices_defaulted u64`) |

#### `ProposalStatus`

| Value | Was present | Fix |
|---|---|---|
| `Active` | ✅ | — |
| `Draft` | ❌ phantom | Removed — proposals go straight to `Active` |
| `Succeeded` | ❌ wrong name | Renamed to `Passed` |
| `Defeated` | ❌ wrong name | Renamed to `Rejected` |
| `Executed` | ✅ | — |
| `Cancelled` | ❌ phantom | Removed — only invoice statuses include `Cancelled` |
| `Vetoed` | ❌ missing | Added |

#### `GovernanceProposal`

| Field | Was present | Fix |
|---|---|---|
| `id`, `proposer`, `status`, `createdAt`, `votingEndsAt` | ✅ | — |
| `title` | ❌ phantom | Removed — not on-chain; proposals use `description_hash` |
| `description` | ❌ phantom | Removed — same reason |
| `abstainVotes` | ❌ phantom | Removed — contract only has `votes_for` / `votes_against` |
| `executedAt` | ❌ wrong semantics | Replaced with `etaLedger` (`eta_ledger u32` — timelock ledger, not timestamp) |
| `forVotes` / `againstVotes` | ✅ | Renamed to `votesFor` / `votesAgainst` to match camelCase convention |
| `descriptionHash` | ❌ missing | Added (`description_hash BytesN<32>`) |
| `actionType` | ❌ missing | Added (`action_type ProposalAction`) |
| `proposedValue` | ❌ missing | Added (`proposed_value i128`) |

#### `ContractStats`

| Field | Was present | Fix |
|---|---|---|
| `totalInvoices`, `totalVolume` | ✅ | |
| `totalYield` | ❌ phantom | Removed — not in `get_contract_stats()` return value |
| `defaultRate` | ❌ phantom | Removed — not in `get_contract_stats()` return value |
| `totalFunded` | ❌ missing | Added (`total_funded u64`) |
| `totalPaid` | ❌ missing | Added (`total_paid u64`) |

#### `LPStats`

| Field | Was present | Fix |
|---|---|---|
| `deployed` | ❌ wrong name | Renamed to `totalFunded` (`total_funded i128`) |
| `yield` | ❌ wrong name + reserved keyword | Renamed to `totalEarned` (`total_earned i128`) |
| `invoiceCount` | ❌ ambiguous | Replaced by explicit `activePositions` + `totalPositions` |
| `defaultRate` | ❌ phantom | Removed — not in `LPStats` struct |
| `activePositions` | ❌ missing | Added (`active_positions u64`) |
| `totalPositions` | ❌ missing | Added (`total_positions u64`) |
| `avgYieldBps` | ❌ missing | Added (`avg_yield_bps u32`) |

#### Events

| Old type name | Issue | Fix |
|---|---|---|
| `InvoiceCreatedEvent` (`"InvoiceCreated"`) | Contract emits `"InvoiceSubmitted"` | New canonical `InvoiceSubmittedEvent`; old name kept as deprecated alias |
| `InvoiceRepaidEvent` (`"InvoiceRepaid"`) | Contract emits `"InvoicePaid"` | New canonical `InvoicePaidEvent`; old name kept as deprecated alias |
| `GovernanceProposalVotedEvent` (`"ProposalVoted"`) | Contract emits `"VoteCast"` | New canonical `VoteCastEvent`; old name kept; `weight: bigint` field added |
| `TokenListedEvent` / `TokenDelistedEvent` | Contract emits `"TokenAdded"` / `"TokenRemoved"` | New canonical events; old names kept as deprecated aliases |
| `InvoiceFundedEvent` | Missing `amountFunded`, `effectiveYieldBps`, `status` | Fields added |
| `ContractStatsUpdatedEvent` / `LPStatsUpdatedEvent` | Not emitted by contract | Retained but documented as client-side synthetic events |

---

## Automated type generation

Manually maintaining `packages/shared/src/types.ts` is the root cause of
every drift finding above. The correct long-term fix is to derive types
directly from the contract's machine-readable Soroban spec.

### How it works

```
stellar contract build         # compiles Rust → WASM
    ↓
stellar contract info          # extracts XDR spec → spec.json
    ↓
scripts/generate-shared-types.mts   # spec.json → types.ts
    ↓
packages/shared/src/types.ts   # committed, never hand-edited
```

### Generating the spec

```bash
# From repo root (requires Stellar CLI and initialized contract submodule)
cd backend
stellar contract build
stellar contract info \
  --wasm target/wasm32v1-none/release/*.wasm \
  --output-format json > target/spec.json
cd ..
```

### Running the generator

```bash
# Generate types.ts from an existing spec.json
pnpm generate:shared-types

# Dry-run — print to stdout without writing
node --import tsx/esm scripts/generate-shared-types.mts \
  --spec backend/target/spec.json \
  --dry-run
```

The generator is scaffolded at `scripts/generate-shared-types.mts`. It reads
the `UdtStructV0`, `UdtEnumV0`, and `UdtUnionV0` entries from `spec.json` and
emits camelCase TypeScript interfaces and union types with inline comments
pointing back to the contract field names and types.

### CI enforcement

Once `backend/target/spec.json` is committed (or generated as a CI artifact),
add this step to `ci.yml` alongside the existing `sdk-types-sync` job:

```yaml
- name: Regenerate shared types
  run: pnpm generate:shared-types

- name: Check if shared types drifted
  run: |
    if ! git diff --exit-code packages/shared/src/types.ts; then
      echo "❌ Shared types are out of sync with the contract spec."
      echo "Run: pnpm generate:shared-types"
      exit 1
    fi
```

### Current status

The generator is scaffolded and the `pnpm generate:shared-types` script is
wired in `package.json`. It cannot run automatically in CI yet because
`backend/target/spec.json` is not committed — the contract submodule must be
initialized and built first. Until then, types.ts is manually maintained and
must be audited against `docs/contracts/` on every contract change.

---

**Last Updated**: July 2026
**Contract Version**: v1.0
**Documentation Version**: 1.0

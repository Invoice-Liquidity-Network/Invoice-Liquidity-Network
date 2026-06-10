# Governance Contract Reference

**Contract Address (Testnet)**: Variable (deployed per instance)

**RPC Endpoint**: https://soroban-testnet.stellar.org

---

## Overview

The ILN Governance Contract manages on-chain governance including proposal creation, voting with delegation, and protocol parameter updates. It coordinates with the Invoice Liquidity Contract to execute governance decisions.

### Key Features

- **Proposal creation** with balance requirements
- **Voting with weight** (own balance + delegated balance)
- **Vote delegation** with cycle detection and transitive resolution
- **Quorum requirements** configurable in basis points
- **Timelock execution** for security
- **Admin veto** capability with governance override
- **Proposal types**: UpdateFeeRate, AddToken, RemoveToken, UpdateMaxDiscountRate

---

## Data Types

### ProposalStatus

```
Active → Passed → Executed (success, after timelock)
    ↓         ↓
  Rejected  Vetoed (admin emergency block)
```

**Status Values:**
- `Active` - Voting period ongoing
- `Passed` - Voting complete, quorum & majority met, waiting for timelock
- `Rejected` - Quorum not met or minority vote
- `Executed` - Successfully executed after timelock
- `Vetoed` - Blocked by admin veto (Issue #68)

### ProposalAction

```typescript
enum ProposalAction {
  UpdateFeeRate(u32),           // Protocol fee in basis points
  AddToken(Address),            // Approve new token
  RemoveToken(Address),         // Remove token from allowlist
  UpdateMaxDiscountRate(u32),   // Max discount rate in basis points
}
```

### GovernanceProposal

```typescript
interface GovernanceProposal {
  id: u64;                          // Unique proposal ID
  proposer: Address;                // Proposal creator
  description_hash: BytesN<32>;     // SHA-256 hash of off-chain description
  action_type: ProposalAction;      // Governance action
  proposed_value: i128;             // Proposed parameter value
  status: ProposalStatus;           // Current state
  votes_for: i128;                  // Cumulative weight voting for
  votes_against: i128;              // Cumulative weight voting against
  created_at: u64;                  // Creation timestamp
  voting_end: u64;                  // Voting deadline timestamp
  eta_ledger: u32;                  // Execution ledger (after timelock)
}
```

---

## Core Functions

### Initialization & Configuration

#### `initialize(iln_contract, gov_token, admin)`

**Access**: Anyone (first call only)

Initialize governance with linked ILN contract and voting token.

**Parameters:**
- `iln_contract: Address` - Invoice Liquidity Contract address
- `gov_token: Address` - Token for voting weight (typically ILN governance token)
- `admin: Address` - Initial admin (can veto proposals)

**Returns:** `Result<(), GovernanceError>`

**Errors:**
- `AlreadyInitialized` - Called more than once

**Events:** None

**Example:**
```typescript
await govContract.initialize({
  ilnContract: invoiceContractAddress,
  govToken: governanceTokenAddress,
  admin: adminAddress
});
```

---

#### `set_min_quorum_bps(min_quorum_bps)`

**Access**: ILN Contract only

Set the minimum quorum requirement (basis points of total supply).

**Parameters:**
- `min_quorum_bps: u32` - Quorum in bps (1-10,000; e.g., 1000 = 10%)

**Returns:** `Result<(), GovernanceError>`

**Errors:**
- `InvalidQuorumBps` - Not in range 1-10,000
- `Unauthorized` - Not called from ILN contract

**Events:** None

**Default:** 1,000 bps (10%)

**Example:**
```typescript
// Called by ILN contract after governance proposal execution
await govContract.setMinQuorumBps({ minQuorumBps: 2000 });  // 20% quorum
```

---

#### `get_min_quorum_bps()`

**Access**: Anyone

Get current minimum quorum requirement.

**Returns:** `u32` - Basis points (default 1,000)

**Example:**
```typescript
const quorum = await govContract.getMinQuorumBps();
console.log("Quorum:", quorum / 100 + "%");
```

---

#### `set_min_proposal_balance(min_balance)`

**Access**: ILN Contract only

Set minimum token balance required to create proposals (anti-spam).

**Parameters:**
- `min_balance: i128` - Balance in smallest token unit

**Returns:** `Result<(), GovernanceError>`

**Errors:**
- `Unauthorized` - Not called from ILN contract

**Default:** 1,000 stroops

**Example:**
```typescript
await govContract.setMinProposalBalance({
  minBalance: BigInt('1000000')  // 0.1 governance token
});
```

---

#### `get_min_proposal_balance()`

**Access**: Anyone

Get minimum balance required to propose.

**Returns:** `i128`

**Example:**
```typescript
const minBal = await govContract.getMinProposalBalance();
```

---

#### `set_execution_delay(admin, delay)`

**Access**: Admin only

Set timelock delay before proposals can execute (Issue #62).

**Parameters:**
- `admin: Address` - Admin account (must authenticate)
- `delay: u32` - Delay in ledgers

**Returns:** `Result<(), GovernanceError>`

**Errors:**
- `Unauthorized` - Not admin

**Default:** 0 (no delay)

**Example:**
```typescript
await govContract.setExecutionDelay({
  admin: adminAddress,
  delay: 100  // ~500 seconds at 5s/ledger
});
```

---

#### `get_execution_delay()`

**Access**: Anyone

Get current timelock delay.

**Returns:** `u32` - Ledgers

**Example:**
```typescript
const delay = await govContract.getExecutionDelay();
```

---

### Proposal Management

#### `create_proposal(proposer, action_type, description_hash, proposed_value)`

**Access**: Proposer must authenticate

Create a governance proposal.

**Parameters:**
- `proposer: Address` - Proposal creator (must authenticate)
- `action_type: ProposalAction` - Governance action enum
- `description_hash: BytesN<32>` - SHA-256 hash of off-chain description/rationale
- `proposed_value: i128` - New parameter value (varies by action type)

**Returns:** `Result<u64, GovernanceError>` - Proposal ID

**Errors:**
- `InsufficientProposerBalance` - Proposer below minimum balance

**Balance Snapshot:**
- Proposer's current balance is snapshotted for voting (allows balance changes post-proposal)

**Voting Period:** 3 days (~259,200 seconds)

**Events:**
- `ProposalCreated` - Proposal details published

**Action Examples:**
```typescript
// Update fee rate to 50 bps (0.5%)
const id1 = await govContract.createProposal({
  proposer: memberAddress,
  actionType: { UpdateFeeRate: 50 },
  descriptionHash: hashDescription("Reduce protocol fee to 0.5%"),
  proposedValue: BigInt(50)
});

// Add new token
const id2 = await govContract.createProposal({
  proposer: memberAddress,
  actionType: { AddToken: newTokenAddress },
  descriptionHash: hashDescription("Add USDT token support"),
  proposedValue: BigInt(0)
});

// Update max discount rate to 5% (500 bps)
const id3 = await govContract.createProposal({
  proposer: memberAddress,
  actionType: { UpdateMaxDiscountRate: 500 },
  descriptionHash: hashDescription("Increase max LP yield"),
  proposedValue: BigInt(500)
});
```

---

#### `get_proposal(proposal_id)`

**Access**: Anyone

Retrieve full proposal details.

**Parameters:**
- `proposal_id: u64` - Proposal ID

**Returns:** `Result<GovernanceProposal, GovernanceError>`

**Errors:**
- `ProposalNotFound`

**Example:**
```typescript
const proposal = await govContract.getProposal({ proposalId: 1 });
console.log("Status:", proposal.status);
console.log("Votes For:", proposal.votes_for);
console.log("Votes Against:", proposal.votes_against);
```

---

#### `list_proposals(status?, page?, page_size?)`

**Access**: Anyone

List proposals with optional status filter and pagination.

**Parameters:**
- `status?: ProposalStatus` - Filter by status (optional)
- `page?: u32` - Page number (0-indexed, default 0)
- `page_size?: u32` - Items per page (max 20, default 20)

**Returns:** `Vec<GovernanceProposal>` - Proposals in reverse ID order

**Pagination:**
- Results ordered newest first
- Max 20 items per page

**Example:**
```typescript
// Get all active proposals
const active = await govContract.listProposals({
  status: 'Active',
  page: 0,
  pageSize: 10
});

// Get all proposals, page 2
const page2 = await govContract.listProposals({
  page: 1,
  pageSize: 20
});
```

---

### Voting

#### `cast_vote(voter, proposal_id, support)`

**Access**: Voter must authenticate

Vote on an active proposal.

**Parameters:**
- `voter: Address` - Voter account (must authenticate)
- `proposal_id: u64` - Target proposal
- `support: bool` - true = vote for, false = vote against

**Returns:** `Result<(), GovernanceError>`

**Errors:**
- `ProposalNotFound`
- `VotingEnded` - Voting deadline passed
- `ProposalNotActive` - Proposal not in Active status
- `AlreadyVoted` - Voter already voted on this proposal
- `NoVotingPower` - Voter weight is zero (no balance + no delegation)

**Voting Weight (Issue #64):**
```
weight = own_snapshot_balance + delegated_weight
```

Where:
- `own_snapshot_balance` - Voter's balance at proposal creation (or first vote if unsnapshotted)
- `delegated_weight` - Total weight transitively delegated to this voter

**Vote Receipt Storage:**
- Stored in temporary storage (for efficiency)
- Outlives voting period for audit trail

**Events:**
- `VoteCast` - voter, proposal_id, support, weight

**Example:**
```typescript
await govContract.castVote({
  voter: memberAddress,
  proposalId: 1,
  support: true  // Vote for
});
```

---

#### `has_voted(voter, proposal_id)`

**Access**: Anyone

Check if a voter has voted on a proposal.

**Parameters:**
- `voter: Address` - Voter to check
- `proposal_id: u64` - Proposal to check

**Returns:** `bool`

**Example:**
```typescript
const voted = await govContract.hasVoted({
  voter: memberAddress,
  proposalId: 1
});
```

---

### Vote Delegation (Issue #64)

#### `delegate_votes(delegator, delegate)`

**Access**: Delegator must authenticate

Delegate voting power to another account.

**Parameters:**
- `delegator: Address` - Account delegating (must authenticate)
- `delegate: Address` - Account receiving delegation

**Returns:** `Result<(), GovernanceError>`

**Errors:**
- `CannotDelegateToSelf` - Cannot delegate to own address
- `DelegationCyclePrevented` - Would create a cycle in delegation chain

**Transitive Delegation:**
- Delegations chain transitively (A → B, B → C means A's weight counts toward C)
- Maximum chain depth: 10 (circuit breaker to prevent long chains)

**Re-delegation:**
- Updates previous delegation (old terminal loses weight, new terminal gains)
- `DelegatedToMe` tally adjusted on both terminals

**Events:**
- `VotesDelegated` - delegator, delegate

**Example:**
```typescript
// Alice delegates to Bob, Bob's voting weight increases
await govContract.delegateVotes({
  delegator: aliceAddress,
  delegate: bobAddress
});

// Later, Bob delegates to Carol
await govContract.delegateVotes({
  delegator: bobAddress,
  delegate: carolAddress
});

// Now Carol's weight includes: her own + Bob + Alice (transitively)
```

---

#### `undelegate_votes(delegator)`

**Access**: Delegator must authenticate

Revoke vote delegation.

**Parameters:**
- `delegator: Address` - Account revoking delegation (must authenticate)

**Returns:** `Result<(), GovernanceError>`

**Events:**
- `VotesUndelegated` - delegator

**Side Effects:**
- Removes delegation pointer
- Reduces `DelegatedToMe` tally on terminal node

**Example:**
```typescript
await govContract.undelegateVotes({
  delegator: aliceAddress
});
```

---

#### `get_delegate(addr)`

**Access**: Anyone

Get the direct delegate for an address (one-hop).

**Parameters:**
- `addr: Address` - Account to query

**Returns:** `Option<Address>` - Direct delegate, or None

**Note:** Returns only the immediate delegate, not transitive chain.

**Example:**
```typescript
const delegate = await govContract.getDelegate({
  addr: aliceAddress
});

if (delegate) {
  console.log("Alice delegates to:", delegate);
} else {
  console.log("Alice has not delegated");
}
```

---

### Proposal Execution

#### `execute_proposal(proposal_id, total_supply)`

**Access**: Anyone

Execute a proposal (voting complete, timelock passed).

**Parameters:**
- `proposal_id: u64` - Proposal to execute
- `total_supply: i128` - Total governance token supply (for quorum calc)

**Returns:** `Result<(), GovernanceError>`

**Errors:**
- `ProposalNotFound`
- `VotingOngoing` - Still in voting period
- `QuorumNotReached` - Total votes < quorum threshold
- `ProposalRejected` - Against ≥ For
- `TimelockNotExpired` - Timelock not yet elapsed
- `AlreadyResolved` - Proposal already executed or vetoed

**Execution Flow:**

1. **Active Proposal:**
   - Check voting period ended
   - Check quorum: `total_votes >= (total_supply * min_quorum_bps / 10,000)`
   - Check majority: `votes_for > votes_against`
   - If passed: mark Passed, schedule for timelock
   - If failed: mark Rejected, return error

2. **Passed Proposal (after timelock):**
   - Check: `current_ledger >= eta_ledger`
   - Execute action via cross-contract call to ILN contract
   - Mark Executed

**Cross-Contract Actions:**
- `UpdateFeeRate(rate)` → `iln_contract.update_fee_rate(rate)`
- `AddToken(token)` → `iln_contract.add_token(token)`
- `RemoveToken(token)` → `iln_contract.remove_token(token)`
- `UpdateMaxDiscountRate(rate)` → `iln_contract.update_max_discount(rate)`

**Events:**
- `ProposalExecuted` - action_type, proposed_value, votes_for, votes_against

**Example:**
```typescript
const totalSupply = BigInt('1000000000');  // 1M gov tokens

await govContract.executeProposal({
  proposalId: 1,
  totalSupply: totalSupply
});
```

---

### Admin Veto (Issue #68)

#### `veto_proposal(proposal_id, reason_hash)`

**Access**: Admin only

Emergency block of a proposal (only when veto power enabled).

**Parameters:**
- `proposal_id: u64` - Proposal to veto
- `reason_hash: BytesN<32>` - SHA-256 hash of veto reason

**Returns:** `Result<(), GovernanceError>`

**Errors:**
- `ProposalNotFound`
- `NotVetoable` - Proposal not in Active/Passed status
- `VetoPowerDisabled` - Veto has been disabled by governance
- `Unauthorized` - Not admin

**Vetoable States:**
- `Active` - Block before voting completes
- `Passed` - Block before execution (even if timelock expired)

**Non-vetoable States:**
- `Executed`, `Rejected`, `Vetoed` - Already final

**Events:**
- `ProposalVetoed` - proposal_id, admin, reason_hash

**Example:**
```typescript
await govContract.vetoProposal({
  proposalId: 1,
  reasonHash: hashVetoReason("Security audit flagged risk")
});
```

---

#### `disable_veto_power()`

**Access**: ILN Contract only

Permanently disable admin veto power (one-way switch).

**Returns:** `Result<(), GovernanceError>`

**Errors:**
- `Unauthorized` - Not called from ILN contract

**Purpose:**
- Allows governance to prevent admin override
- Typically called before mainnet launch
- Cannot be re-enabled

**Events:** None

**Example:**
```typescript
// Called by ILN contract after governance proposal to disable veto
await govContract.disableVetoPower();
```

---

#### `is_veto_power_enabled()`

**Access**: Anyone

Check if admin veto power is currently active.

**Returns:** `bool`

**Example:**
```typescript
const vetoActive = await govContract.isVetoPowerEnabled();
```

---

## Error Codes

| Error | Code | Meaning |
|-------|------|---------|
| `AlreadyInitialized` | 1 | Contract already initialized |
| `ProposalNotFound` | 2 | Proposal ID does not exist |
| `VotingEnded` | 3 | Voting period has closed |
| `ProposalNotActive` | 4 | Proposal not in Active status |
| `NoVotingPower` | 5 | Voter has zero weight |
| `AlreadyVoted` | 6 | Voter already voted on this proposal |
| `VotingOngoing` | 7 | Still in voting period |
| `QuorumNotReached` | 8 | Total votes below quorum |
| `ProposalRejected` | 9 | Against ≥ For |
| `AlreadyResolved` | 10 | Proposal already finalized |
| `CannotDelegateToSelf` | 11 | Cannot delegate to own address |
| `DelegationCyclePrevented` | 12 | Would create cycle in chain |
| `TimelockNotExpired` | 13 | Timelock delay not elapsed |
| `Unauthorized` | 14 | Caller not authorized |
| `InvalidQuorumBps` | 15 | Quorum not in 1-10,000 range |
| `NotAdmin` | 16 | Caller is not admin |
| `NotVetoable` | 17 | Proposal cannot be vetoed in current status |
| `VetoPowerDisabled` | 18 | Admin veto power has been disabled |
| `InsufficientProposerBalance` | 19 | Proposer below minimum balance |

---

## Constants

```typescript
const VOTE_RECEIPT_TTL_THRESHOLD_LEDGERS: u32 = 50_000;
const VOTE_RECEIPT_TTL_LEDGERS: u32 = 69_120;
const DEFAULT_MIN_QUORUM_BPS: u32 = 1_000;      // 10%
const VOTING_PERIOD_SECS: u64 = 259_200;        // 3 days
const DEFAULT_MIN_PROPOSAL_BALANCE: i128 = 1_000; // stroops
const MAX_DELEGATION_DEPTH: u32 = 10;           // Max transitive chain
```

---

## Workflow Example: Create & Execute a Proposal

```typescript
// Step 1: Create proposal
const proposalId = await govContract.createProposal({
  proposer: memberAddress,
  actionType: { UpdateFeeRate: 50 },
  descriptionHash: hashDescription("Reduce fee to 0.5%"),
  proposedValue: BigInt(50)
});
console.log("Created proposal:", proposalId);

// Step 2: Members vote (over 3 days)
await govContract.castVote({
  voter: member1Address,
  proposalId: proposalId,
  support: true
});

await govContract.castVote({
  voter: member2Address,
  proposalId: proposalId,
  support: true
});

// Step 3: Query voting results
const proposal = await govContract.getProposal({ proposalId: proposalId });
console.log("Votes for:", proposal.votes_for);
console.log("Votes against:", proposal.votes_against);

// Step 4: After voting period + timelock, execute
const totalSupply = await getGovernanceTokenTotalSupply();
await govContract.executeProposal({
  proposalId: proposalId,
  totalSupply: totalSupply
});

console.log("Proposal executed! Fee updated on ILN contract.");
```

---

## Integration with Invoice Contract

The Governance Contract coordinates with the Invoice Liquidity Contract:

1. **Governance calls ILN contract** to execute approved proposals
2. **ILN contract calls governance** to update quorum/minimum balance settings
3. **Both use same token** for voting weight and balance checks

**Authorization Pattern:**
```typescript
// In governance contract
iln_contract.require_auth();  // Must be called by ILN contract
```

---

## Cross-References

- **Invoice Liquidity Contract**: [Invoice Contract Reference](./invoice-contract.md)
- **Reputation Contract**: [Reputation Contract Reference](./reputation-contract.md)
- **Integration Guide**: [Integration & SDK Usage](../integration-guide.md)
- **Event Schema**: [Event Documentation](../event-schema.md)
- **Smart Contract Source**: [GitHub - ILN Governance](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/tree/main/contracts/iln_governance)

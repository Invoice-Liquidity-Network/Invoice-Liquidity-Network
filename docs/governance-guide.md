# Governance Guide

This guide explains how ILN on-chain governance works, how to create and vote on proposals, and how protocol parameters are changed.

---

## Governance Overview

ILN uses token-weighted on-chain governance so that token holders collectively control protocol parameters. There is no single administrator — every parameter change must pass a community vote.

### What token holders can do

- Propose parameter changes (fee rate, max discount rate, supported tokens)
- Vote on active proposals with weight proportional to their token balance
- Delegate voting power to another address (transitive delegation, max 10 hops)
- Execute proposals that have passed their timelock
- Disable admin veto power permanently (via governance vote)

### Proposal lifecycle

```
create_proposal()
       │
       ▼
   [Active]  ← voting period (3 days)
    │    │
    │    └─── quorum not met or against ≥ for ──▶ [Rejected]
    │
    └─── quorum met AND for > against
              │
              ▼
          [Passed]  ← timelock delay (configurable)
              │
    ┌─────────┴──────────┐
    │                    │
    ▼                    ▼
[Executed]           [Vetoed]  ← admin emergency block
```

### Governance parameters (testnet defaults)

| Parameter              | Default      | Description                                   |
| ---------------------- | ------------ | --------------------------------------------- |
| Voting period          | 3 days (259,200 s) | Duration of the voting window         |
| Quorum                 | 1,000 bps (10%) | Minimum share of total supply that must vote |
| Minimum proposal balance | 1,000 stroops | Tokens required to submit a proposal        |
| Execution delay        | 0 ledgers    | Timelock before execution (admin-configurable)|
| Max delegation depth   | 10 hops      | Circuit breaker for transitive delegation chains |
| Veto power             | Enabled      | Can be permanently disabled by governance vote |

### Contract addresses

| Network  | Contract ID                                              |
| -------- | -------------------------------------------------------- |
| Testnet  | `CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB` |
| Mainnet  | Coming after audit                                       |

> **Cross-repo reference:** The governance contract's implementation lives in the [ILN-Smart-Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) repository under `contracts/iln_governance`. See the [Governance Contract Reference](./contracts/governance-contract.md) for the full API surface.

### Contract addresses

| Network  | Contract ID                                              |
| -------- | -------------------------------------------------------- |
| Testnet  | `CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB` |
| Mainnet  | Coming after audit                                       |

---

## Multi-Sig Admin and Key Custody

The ILN governance contract supports admin privileges (emergency veto, execution delay configuration) that are held by a multi-signature admin setup for production safety. The complete multi-sig runbook — including key allocation, quorum thresholds, timelock procedures, HSM custody, and emergency response steps — is maintained as the **authoritative source** in the [ILN-Smart-Contract repository](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract).

> **For the full multi-sig runbook:** See the smart contract repo's operational documentation covering 2-of-3 (testnet) and 4-of-7 (mainnet) signer configurations, key custody procedures, and emergency pause/unpause workflows.

This governance guide covers the **governance process** (proposals, voting, delegation) rather than admin key-management details. The admin's powers in the governance contract are:

- **Veto power** — can block proposals in Active or Passed state (can be permanently disabled by governance vote via `disable_veto_power`)
- **Execution delay** — configures the timelock before proposal execution
- **Emergency circuit breaker** — immediate halt (coordinated through the multi-sig runbook)

---

## Proposal Creation Guide

### Prerequisites

1. Install the SDK:
   ```bash
   npm install @iln/sdk
   ```

2. Your account must hold at least **1,000 stroops** of the ILN governance token to submit a proposal.

3. You need a funded Stellar testnet account with a secret key.

### Setting up the client

```typescript
import {
  GovernanceClient,
  GOVERNANCE_TESTNET,
  ProposalActionKind,
} from '@iln/sdk';
import crypto from 'crypto';

const client = new GovernanceClient(GOVERNANCE_TESTNET);

// Helper to produce a 32-byte description hash
function hashDescription(text: string): Buffer {
  return Buffer.from(crypto.createHash('sha256').update(text).digest());
}
```

### Creating proposals

#### Update the protocol fee rate

```typescript
const tx = await client.createProposal({
  proposer: 'G...YOUR_ADDRESS',
  action: {
    kind: ProposalActionKind.UpdateFeeRate,
    rate: 50, // 50 bps = 0.5%
  },
  descriptionHash: hashDescription('Reduce protocol fee from 1% to 0.5%'),
  proposedValue: 50n,
});

// Sign and submit `tx` with your Stellar signer
```

#### Update the maximum discount rate

```typescript
const tx = await client.createProposal({
  proposer: 'G...YOUR_ADDRESS',
  action: {
    kind: ProposalActionKind.UpdateMaxDiscountRate,
    rate: 500, // 500 bps = 5%
  },
  descriptionHash: hashDescription('Increase max LP discount rate to 5%'),
  proposedValue: 500n,
});
```

#### Add a new supported token

```typescript
const tx = await client.createProposal({
  proposer: 'G...YOUR_ADDRESS',
  action: {
    kind: ProposalActionKind.AddToken,
    tokenAddress: 'C...TOKEN_CONTRACT_ADDRESS',
  },
  descriptionHash: hashDescription('Add EURC as a supported invoice token'),
  proposedValue: 0n,
});
```

#### Remove a supported token

```typescript
const tx = await client.createProposal({
  proposer: 'G...YOUR_ADDRESS',
  action: {
    kind: ProposalActionKind.RemoveToken,
    tokenAddress: 'C...TOKEN_CONTRACT_ADDRESS',
  },
  descriptionHash: hashDescription('Remove deprecated token X'),
  proposedValue: 0n,
});
```

---

## Voting Guide

### Cast a vote

```typescript
import { GovernanceClient, GOVERNANCE_TESTNET } from '@iln/sdk';

const client = new GovernanceClient(GOVERNANCE_TESTNET);

// Vote in favour of proposal 1
const tx = await client.castVote({
  voter: 'G...YOUR_ADDRESS',
  proposalId: 1n,
  support: true,  // false = vote against
});

// Sign and submit `tx` with your Stellar signer
```

### Check if you have already voted

```typescript
// hasVoted is a read-only simulation — no signing required
const { result } = client.getProposal({ proposalId: 1n });
// Check the proposal's votes_for / votes_against fields
```

### Inspect a proposal

```typescript
const builtTx = client.getProposal({ proposalId: 1n });
// simulate builtTx with your RPC client to read proposal fields:
// id, status, votesFor, votesAgainst, proposer, createdAt, votingEnd
```

### List active proposals

```typescript
const builtTx = client.listProposals({
  status: ProposalStatus.Active,
  page: 0,
  pageSize: 20,
});
// simulate builtTx to get an array of GovernanceProposal
```

### Delegate your voting power

Delegation lets you assign your token weight to a trusted community member.

```typescript
// Alice delegates to Bob
const tx = await client.delegateVotes({
  delegator: 'G...ALICE',
  delegate:  'G...BOB',
});
// Sign and submit `tx`
```

Delegation is transitive: if Bob also delegates to Carol, Carol's effective voting weight includes Bob's and Alice's tokens.

### Revoke delegation

```typescript
const tx = await client.undelegateVotes({
  delegator: 'G...ALICE',
});
// Sign and submit `tx`
```

---

## Parameter Change Examples

The following examples walk through end-to-end flows on **testnet**.

### Example 1 — Reduce the protocol fee rate from 1% to 0.5%

**Current state:** `feeRate = 100` (100 bps = 1%)  
**Goal:** `feeRate = 50` (50 bps = 0.5%)

```typescript
import { GovernanceClient, GOVERNANCE_TESTNET, ProposalActionKind } from '@iln/sdk';
import { Keypair, TransactionBuilder, Networks, rpc } from '@stellar/stellar-sdk';
import crypto from 'crypto';

const client = new GovernanceClient(GOVERNANCE_TESTNET);
const server = new rpc.Server(GOVERNANCE_TESTNET.rpcUrl);
const proposer = Keypair.fromSecret(process.env.SECRET_KEY!);

// Step 1: Create the proposal
const createTx = await client.createProposal({
  proposer: proposer.publicKey(),
  action: { kind: ProposalActionKind.UpdateFeeRate, rate: 50 },
  descriptionHash: Buffer.from(
    crypto.createHash('sha256').update('Reduce protocol fee to 0.5%').digest()
  ),
  proposedValue: 50n,
});
createTx.transaction.sign(proposer);
const { hash: proposalTxHash } = await server.sendTransaction(createTx.transaction);
console.log('Proposal submitted, tx hash:', proposalTxHash);

// Step 2: Community members vote (within 3 days)
const voteTx = await client.castVote({
  voter: proposer.publicKey(),
  proposalId: 1n,
  support: true,
});
voteTx.transaction.sign(proposer);
await server.sendTransaction(voteTx.transaction);
console.log('Vote cast');

// Step 3: After voting period + timelock, execute
const totalSupply = 1_000_000_000n; // replace with actual governance token supply
const execTx = await client.executeProposal({
  source: proposer.publicKey(),
  proposalId: 1n,
  totalSupply,
});
execTx.transaction.sign(proposer);
await server.sendTransaction(execTx.transaction);
console.log('Proposal executed — fee rate updated to 50 bps');
```

### Example 2 — Increase max discount rate to 5%

**Current state:** `maxDiscountRate = 300` (300 bps = 3%)  
**Goal:** `maxDiscountRate = 500` (500 bps = 5%)

```typescript
const tx = await client.createProposal({
  proposer: proposer.publicKey(),
  action: { kind: ProposalActionKind.UpdateMaxDiscountRate, rate: 500 },
  descriptionHash: Buffer.from(
    crypto.createHash('sha256').update('Increase max LP yield ceiling to 5%').digest()
  ),
  proposedValue: 500n,
});
tx.transaction.sign(proposer);
await server.sendTransaction(tx.transaction);
```

---

## FAQ

**Q: How many tokens do I need to create a proposal?**  
A: At least 1,000 stroops (default `min_proposal_balance`, configurable by governance). Your current balance is snapshotted at proposal creation — balance changes afterward do not affect the proposal.

**Q: How is my voting weight calculated?**  
A: Your weight = your own token balance (snapshotted at proposal creation) + any tokens delegated to you transitively. If you delegated your tokens away before the vote, your own weight is zero.

**Q: Can I vote if I delegated my tokens?**  
A: No. If you have an active delegation your weight counts toward your delegate's vote. Revoke delegation first with `undelegateVotes` if you want to vote directly.

**Q: Can I change my vote after casting it?**  
A: No. Each address may only vote once per proposal (`AlreadyVoted` error is returned on a second attempt).

**Q: What is the maximum delegation chain depth?**  
A: 10 hops (`MAX_DELEGATION_DEPTH`). Chains longer than 10 are rejected with `DelegationCyclePrevented` as a circuit breaker to prevent infinite delegation loops.

**Q: Can the admin veto any proposal?**  
A: Yes, while veto power is enabled. The admin can block proposals in `Active` or `Passed` state (error `NotVetoable` for other states). Veto power can be permanently disabled by calling `disable_veto_power` through the ILN contract after a governance vote, after which no single party can block proposals.

**Q: Can veto power be re-enabled after being disabled?**  
A: No. `disable_veto_power` is a one-way switch — once disabled, veto power cannot be re-enabled. This is by design to allow governance to fully control the protocol.

**Q: Is testnet governance the same as mainnet?**  
A: The contract logic is identical. Testnet uses `GOVERNANCE_TESTNET_CONTRACT_ID` (`CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB`). Testnet tokens have no real value; use them freely for experimentation.

**Q: Where is the off-chain proposal description stored?**  
A: Only a SHA-256 hash (`description_hash`) is stored on-chain. The full description should be published on the ILN governance forum or IPFS and the hash must match what was submitted.

**Q: What happens if quorum is not met?**  
A: The proposal moves to `Rejected` status after the voting period ends. A new proposal with the same parameters can be submitted.

**Q: What is the vote receipt TTL?**  
A: Vote receipts are stored in temporary storage with a TTL threshold of 50,000 ledgers and an explicit TTL of 69,120 ledgers (~4 days at 5s/ledger) for audit trail purposes.

**Q: What error do I get if I try to vote after the voting deadline?**  
A: `VotingEnded` (error code 3). The voting period is exactly 3 days (259,200 seconds) from proposal creation.

**Q: What happens if I try to delegate to myself?**  
A: `CannotDelegateToSelf` (error code 11). The contract prevents self-delegation.

---

## Further reading

- [Governance Contract Reference](./contracts/governance-contract.md) — full contract API and error codes
- [SDK API Reference](./sdk-api-reference.md) — SDK governance client methods
- [Protocol Overview](./protocol-overview.md) — system-wide design context
- [ILN Smart Contract Repository](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) — contract source and multi-sig runbook
- [Governance Monitor Example](../examples/governance-monitor/README.md) — reference implementation for contract monitoring

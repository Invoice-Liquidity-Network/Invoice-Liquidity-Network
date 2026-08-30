# Governance Guide

This guide explains how ILN on-chain governance works, how to create and vote on proposals, and how protocol parameters are changed.

---

## Governance Overview

ILN uses token-weighted on-chain governance so that token holders collectively control protocol parameters. There is no single administrator — every parameter change must pass a community vote.

### What token holders can do

- Propose parameter changes (fee rate, max discount rate, supported tokens)
- Vote on active proposals with weight proportional to their token balance
- Delegate voting power to another address
- Execute proposals that have passed their timelock

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
          [Passed]  ← timelock delay
              │
    ┌─────────┴──────────┐
    │                    │
    ▼                    ▼
[Executed]           [Vetoed]  ← admin emergency block (temporary)
```

### Governance parameters (testnet defaults)

| Parameter              | Default      | Description                                   |
| ---------------------- | ------------ | --------------------------------------------- |
| Voting period          | 3 days       | Duration of the voting window                 |
| Quorum                 | 10%          | Minimum share of total supply that must vote  |
| Minimum proposal balance | 1,000 stroops | Tokens required to submit a proposal        |
| Execution delay        | 0 ledgers    | Timelock before execution (admin-configurable)|

### Contract addresses

| Network  | Contract ID                                              |
| -------- | -------------------------------------------------------- |
| Testnet  | `CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB` |
| Mainnet  | Coming after audit                                       |

---

## Production Multi-Sig Admin Configuration

For mainnet production safety, all privileged administrator powers (such as emergency circuit breaking, parameter overrides, contract upgrade execution, and dispute resolution fallback) are transferred to an m-of-n Multi-Sig Admin setup coordinated across the [ILN-Smart-Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) and main repository runbooks.

### Multi-Sig Quorum and Thresholds

| Network | Signer Setup | Quorum Threshold | Timelock Delay | Purpose |
| --- | --- | --- | --- | --- |
| **Testnet** | 2-of-3 Multi-Sig | 2 Signers | 0 ledgers | Fast iteration and development testing |
| **Mainnet** | 4-of-7 Multi-Sig | 4 Core Signers | 48 hours (approx. 34,560 ledgers) | Routine upgrades, parameter governance overrides |
| **Emergency Mainnet** | 3-of-7 Multi-Sig | 3 Core Signers | 0 ledgers (Emergency Pause only) | Circuit breaker activation during active exploit |

### Admin Key Allocation
- **Protocol Engineers**: 3 keys distributed across core protocol maintainers in separate hardware security modules (HSMs).
- **Security & Auditor Custodians**: 2 keys held by external security audit partners.
- **Community / Governance Custodians**: 2 keys held by community elected stewards.

### Emergency Response & Timelock Procedure
1. **Emergency Pause (Circuit Breaker)**: Requires 3-of-7 threshold to immediately halt funding and invoice creation without delay.
2. **Unpause / Upgrade / Parameter Override**: Requires 4-of-7 threshold and enforces a mandatory 48-hour timelock to allow ecosystem participants to inspect proposed changes.
3. **Cross-Repo Coordination**: Operational multi-sig runbooks and deployment execution scripts are maintained in the [ILN-Smart-Contract repository](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) and cross-verified before each release.

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
A: At least 1,000 stroops of the ILN governance token at the time you call `create_proposal`. If your balance drops after submission the proposal still proceeds.

**Q: How is my voting weight calculated?**  
A: Your weight = your own token balance at proposal creation + any tokens delegated to you (transitively). If you delegated your tokens away before the vote, your own weight is zero.

**Q: Can I vote if I delegated my tokens?**  
A: No. If you have an active delegation your weight counts toward your delegate's vote. Revoke delegation first with `undelegateVotes` if you want to vote directly.

**Q: Can I change my vote after casting it?**  
A: No. Each address may only vote once per proposal (`AlreadyVoted` error is returned on a second attempt).

**Q: What is the maximum delegation chain depth?**  
A: 10 hops. Chains longer than 10 are rejected with `DelegationCyclePrevented` as a circuit breaker.

**Q: Can the admin veto any proposal?**  
A: Yes, while veto power is enabled. The admin can block proposals in `Active` or `Passed` state. Veto power can be permanently disabled by a governance vote, after which no single party can block proposals.

**Q: Is testnet governance the same as mainnet?**  
A: The contract logic is identical. Testnet uses `GOVERNANCE_TESTNET_CONTRACT_ID` (`CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB`). Testnet tokens have no real value; use them freely for experimentation.

**Q: Where is the off-chain proposal description stored?**  
A: Only a SHA-256 hash is stored on-chain. The full description should be published on the ILN governance forum or IPFS and the hash must match what was submitted.

**Q: What happens if quorum is not met?**  
A: The proposal moves to `Rejected` status after the voting period ends. A new proposal with the same parameters can be submitted.

---

## Further reading

- [Governance Contract Reference](./contracts/governance-contract.md)
- [SDK API Reference](./sdk-api-reference.md)
- [Protocol Overview](./protocol-overview.md)

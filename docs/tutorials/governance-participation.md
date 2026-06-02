# Governance Participation Tutorial

This tutorial walks you through reading an active proposal, casting a vote, and monitoring it through to execution on the Invoice Liquidity Network (ILN). No prior on-chain governance experience is required.

**Prerequisites:**
- A Stellar wallet with [Freighter](https://freighter.app/) installed
- Some ILN tokens in your wallet (needed for voting power)
- Access to the [ILN governance UI](https://app.iln.finance/governance) (or testnet equivalent)

---

## How Governance Works

ILN governance is controlled by ILN token holders through the `ILN-Governance` contract (`CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB` on testnet).

**Key concepts:**

| Concept | Description |
|---------|-------------|
| **Proposal** | A on-chain action to change a protocol parameter (e.g., discount rate, quorum threshold) or execute a contract call |
| **Voting window** | The period during which token holders can cast votes. Typically 7 days |
| **Quorum** | Minimum percentage of total voting power that must participate for the vote to be valid |
| **Timelock** | A mandatory delay between a proposal passing and it being executed, giving users time to react |
| **Execution** | Once a proposal passes and the timelock expires, anyone can call `execute()` to apply the change on-chain |

**Proposal lifecycle:**

```
Created → Active (voting window) → Passed/Failed → Timelock → Executed
```

A proposal fails if it does not reach quorum or if "No" votes outweigh "Yes" votes.

---

## Step 1: Navigate to the Governance Page

1. Open the ILN dApp: `https://app.iln.finance/governance`
2. Connect your Freighter wallet by clicking **Connect Wallet** in the top-right corner
3. You will see a list of proposals grouped by status: **Active**, **Passed**, **Failed**, **Executed**

> **Testnet:** Use `https://testnet.iln.finance/governance` and switch Freighter to the Testnet network.

![Governance page overview](../assets/governance-overview.png)

---

## Step 2: Read an Active Proposal

Click any proposal with an **Active** badge to open the detail view.

Each proposal shows:

- **Title** — a short human-readable description (e.g., "Increase quorum to 15%")
- **Action type** — what the proposal will do if it passes:
  - `ParameterChange` — updates a contract configuration value
  - `ContractUpgrade` — replaces contract WASM
  - `TreasuryTransfer` — moves funds from the protocol treasury
- **Proposed value** — the new value being set (e.g., `quorum_bps: 1500` means 15.00%)
- **Current value** — what the parameter is set to today
- **Voting window** — when voting opened and when it closes (shown as a countdown)
- **Quorum progress** — how much of the required voting power has participated so far
- **Vote tally** — current Yes / No / Abstain breakdown

**Example proposal detail:**

```
Title:         Increase minimum discount rate
Action type:   ParameterChange
Parameter:     min_discount_bps
Current value: 100  (1.00%)
Proposed value: 250 (2.50%)

Voting closes: 2026-06-09 09:00 UTC (6 days remaining)
Quorum:        12.4% of 20% required
Votes:         Yes 8.1%  No 4.3%  Abstain 0.0%
```

Take time to understand the proposed value. For `_bps` parameters, divide by 100 to get a percentage.

---

## Step 3: Check Your Voting Power

Your voting power is determined by your ILN token balance **at the block when the proposal was created** (the snapshot block). Tokens acquired after that point do not count for this proposal.

1. In the proposal detail view, your voting power is shown in the **Your Vote** panel on the right
2. Alternatively, check via the CLI:

```bash
iln governance voting-power --address YOUR_STELLAR_ADDRESS --proposal-id 42
```

If your voting power shows `0` despite holding ILN tokens, you likely acquired them after the snapshot. Your tokens will count for future proposals.

> **Delegation:** If another address has delegated their votes to you, that weight is included in your displayed voting power. See [Vote Delegation](#vote-delegation-advanced) below.

---

## Step 4: Cast Your Vote

1. In the **Your Vote** panel, select your position: **Yes**, **No**, or **Abstain**
2. Review the confirmation dialog — it shows the proposal ID, your choice, and your voting weight
3. Click **Submit Vote** and approve the transaction in Freighter

The transaction calls `cast_vote(proposal_id, vote)` on the governance contract. Once confirmed (usually within 5–10 seconds on Stellar), your vote is recorded on-chain.

**Via CLI:**

```bash
iln governance vote --proposal-id 42 --choice yes --keypair ~/.config/iln/keypair.json
```

---

## Step 5: Verify Your Vote Was Recorded

After the transaction confirms:

1. The **Your Vote** panel updates to show your recorded choice and weight
2. The vote tally refreshes to include your contribution

To verify independently via the CLI:

```bash
iln governance proposal --id 42
```

Look for your address in the `votes` list, or check the quorum progress — it should have increased by your voting weight.

You can also verify directly against the contract using Stellar's Horizon or the Stellar Lab:

```
https://laboratory.stellar.org/#explorer?resource=contract_data&network=testnet
Contract ID: CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB
Key: Proposal(42)
```

---

## Step 6: Monitor Proposal Status Through to Execution

After voting closes, the proposal moves through the remaining lifecycle stages. You can monitor this from the governance page or with the CLI.

**Track status:**

```bash
# Poll every 60 seconds (useful during the voting window close)
watch -n 60 iln governance proposal --id 42
```

**Possible outcomes after the voting window closes:**

| Status | Meaning |
|--------|---------|
| `Passed` | Quorum met, Yes > No — enters the timelock period |
| `Failed` | Quorum not met, or No ≥ Yes — no further action |
| `Executed` | Timelock expired, proposal was executed on-chain |

**Trigger execution after the timelock:**

Once a passed proposal's timelock expires, execute it:

```bash
iln governance execute --proposal-id 42
```

Anyone can call this — you do not need to be the proposer. The governance UI also shows an **Execute** button when a proposal is ready.

---

## Vote Delegation (Advanced)

Delegation lets you assign your voting power to another address. This is useful if you hold ILN tokens but prefer to let an active community member vote on your behalf.

### Delegate your votes

```bash
iln governance delegate --to DELEGATE_STELLAR_ADDRESS --keypair ~/.config/iln/keypair.json
```

Or via the UI: **Governance → My Voting Power → Delegate**

- Delegation applies to all future proposals from the moment it is set
- It does not affect proposals that have already taken a snapshot
- You retain ownership of your tokens — only voting power is delegated

### Revoke delegation

```bash
iln governance delegate --to self --keypair ~/.config/iln/keypair.json
```

Passing `--to self` (or your own address) returns voting power to you.

### Check current delegation

```bash
iln governance delegations --address YOUR_STELLAR_ADDRESS
```

This shows who you have delegated to and which addresses have delegated to you.

---

## Troubleshooting

**"Voting power is 0" despite holding ILN tokens**
Your tokens were acquired after the proposal's snapshot block. They will count for future proposals.

**Transaction rejected by Freighter**
Ensure Freighter is set to the correct network (testnet vs mainnet) and that your account has enough XLM for the transaction fee (~0.00001 XLM).

**Proposal not showing in the UI**
The indexer may be catching up. Wait a minute and refresh, or query the contract directly:
```bash
iln governance proposals --status active
```

**Execute transaction fails**
The timelock has not yet expired, or the proposal failed. Check the proposal status with `iln governance proposal --id <id>`.

---

## Further Reading

- [Governance reference doc](../governance.md)
- [ILN-Governance contract source](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract)
- [Stellar Soroban docs](https://soroban.stellar.org/docs)

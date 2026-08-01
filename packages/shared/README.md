# `@iln/shared`

Shared TypeScript types for the Invoice Liquidity Network. This package is the
**single source of truth** for domain types consumed by `@iln/sdk`,
`@iln/cli`, `@iln/indexer`, and `@iln/notifications`.

Every type is derived directly from the Soroban contract structs and enums in
`docs/contracts/`. Field names use camelCase equivalents of the contract's
snake_case names. The contract source for each type is noted in `src/types.ts`
so drift can be caught at review time.

## Install

```bash
npm install @iln/shared
```

## Usage

```ts
import type { Invoice, ContractStats, InvoiceStatus } from "@iln/shared";
```

All exports are **type-only**. There are no runtime values in this package.

---

## What belongs here

| Belongs in `@iln/shared` | Does NOT belong here |
|---|---|
| TypeScript interfaces and type aliases that map 1:1 to on-chain contract structs/enums | Runtime logic, functions, or classes |
| Canonical event types emitted by the Soroban contracts | API route handlers or business logic |
| Client-side utility types that mirror contract return values (e.g. `Token`, `ContractStats`) | SDK methods, CLI commands, or indexer transforms |
| Shared constants derived from contract parameters (if added in the future) | Validation schemas (use `zod` or similar in the consuming package) |

**Rule of thumb:** if it changes when the Soroban contract schema changes, it
belongs here. If it's behaviour or orchestration, put it in the package that owns
that concern.

---

## Exported symbols

### Enums / Literal unions

| Export | Description |
|---|---|
| `InvoiceStatus` | All nine on-chain invoice states (`Pending`, `PartiallyFunded`, `Funded`, `Paid`, `Defaulted`, `Appealed`, `Disputed`, `Expired`, `Cancelled`) |
| `ProposalStatus` | Five governance proposal states (`Active`, `Passed`, `Rejected`, `Executed`, `Vetoed`) |
| `ProposalAction` | Discriminated union of the four governance action variants (`UpdateFeeRate`, `AddToken`, `RemoveToken`, `UpdateMaxDiscountRate`) |

### Deprecated type aliases

| Export | Replaced by | Notes |
|---|---|---|
| `InvoiceState` | `InvoiceStatus` | Was a 4-member subset; now a full alias |

### Core domain types

| Export | Description |
|---|---|
| `Invoice` | Full invoice struct — ID, parties, token, amounts, status, funding fields, and optional Dutch-auction parameters |
| `ReputationScore` | Address reputation profile — score (0-100+), lifetime submitted/paid/defaulted counts, last activity ledger |
| `GovernanceProposal` | Proposal struct — proposer, description hash, action, votes, status, timelock ETA |
| `Token` | Client-side convenience type — contract ID, symbol, name, decimals, issuer, listing status (not a contract struct) |
| `ContractStats` | Aggregate protocol stats — total invoices, funded, paid, and cumulative volume |
| `LPStats` | Liquidity-provider stats — total funded, earned, active positions, average yield in bps |

### Contract events (canonical names)

| Export | Description |
|---|---|
| `InvoiceSubmittedEvent` | Emitted when an invoice is submitted on-chain |
| `InvoiceFundedEvent` | Emitted when an LP funds an invoice (includes effective yield) |
| `InvoicePaidEvent` | Emitted when the payer settles an invoice |
| `InvoiceDefaultedEvent` | Emitted when an invoice defaults past its due date |
| `GovernanceProposalCreatedEvent` | Emitted when a governance proposal is created |
| `VoteCastEvent` | Emitted when a vote is cast on a proposal |
| `GovernanceProposalExecutedEvent` | Emitted when a passed proposal is executed |
| `TokenAddedEvent` | Emitted when a token is approved on the contract |
| `TokenRemovedEvent` | Emitted when a token is removed from the contract |
| `ReputationUpdatedEvent` | Emitted when a user's reputation score changes |

### Client-side synthetic events

These are not emitted by the contract but are retained as utility types for
consumers that synthesise stats update notifications locally.

| Export | Description |
|---|---|
| `ContractStatsUpdatedEvent` | Wraps `ContractStats` in the `ContractEventBase` envelope |
| `LPStatsUpdatedEvent` | Wraps per-address `LPStats` in the `ContractEventBase` envelope |

### Union type

| Export | Description |
|---|---|
| `ContractEvent` | Union of all event types above — use this when handling any event |

### Deprecated event aliases

Kept for backward compatibility. Prefer the canonical names above.

| Export | Replaced by |
|---|---|
| `InvoiceCreatedEvent` | `InvoiceSubmittedEvent` |
| `InvoiceRepaidEvent` | `InvoicePaidEvent` |
| `GovernanceProposalVotedEvent` | `VoteCastEvent` |
| `TokenListedEvent` | `TokenAddedEvent` |
| `TokenDelistedEvent` | `TokenRemovedEvent` |

---

## Contributing

Before adding or removing fields, update the corresponding contract spec in
`docs/contracts/` first. Automated type generation is scaffolded in
`scripts/generate-shared-types.mts`.

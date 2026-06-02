# @iln/mock-backend

In-memory mock backend for the **Invoice Liquidity Network** frontend.  
Enables fully offline development — no Stellar node, no RPC connection, no wallet required.

---

## Why this exists

Frontend developers currently need a running local Stellar node to work on UI features. This package provides drop-in replacements for all three client interfaces (`InvoiceClient`, `ReputationClient`, `GovernanceClient`) backed by an in-memory store pre-populated with realistic test data.

---

## Quick start

```ts
import { ILNMockBackend } from "@iln/mock-backend";

const mock = new ILNMockBackend();

// Read invoices
const invoices  = await mock.invoice.getAllInvoices();
const score     = await mock.reputation.getPayerScore(address);
const proposals = await mock.governance.fetchProposals();

// Write operations update in-memory state immediately
const { invoiceId } = await mock.invoice.submitInvoice({ ... });
await mock.invoice.fundInvoice(funderAddress, invoiceId);
await mock.invoice.markPaid(payerAddress, invoiceId);
```

---

## Using in the frontend (dev mode)

1. Copy `.env.local.example` → `.env.local` in the `frontend/` directory.
2. Set `NEXT_PUBLIC_ILN_MOCK=1`.
3. Import from `@/lib/mock-client` instead of `@/utils/soroban` where needed.

The `frontend/src/lib/mock-client.ts` adapter exports the same function signatures as `soroban.ts`, so pages can switch between real and mock implementations with a one-line change.

---

## Seed data

The package ships with 13 pre-populated invoices covering all statuses (`Pending`, `Funded`, `Paid`, `Defaulted`, `Cancelled`, `Expired`) across two tokens (USDC and EURC), plus:

- 5 reputation scores (BOB has a perfect record; DAVE has defaults)
- 6 governance proposals in all lifecycle states
- Token balances and allowances for all test addresses

Named test addresses are exported for use in tests:

```ts
import { ALICE, BOB, CAROL, DAVE, EVE, FRANK, USDC_ID, EURC_ID } from "@iln/mock-backend";
```

---

## Customising seed data

```ts
const mock = new ILNMockBackend({
  invoices: myCustomInvoices,
  reputation: myReputationMap,
  proposals: myProposals,
  votingPower: 5_000, // ILN tokens for the connected wallet
});
```

You can also instantiate individual clients:

```ts
import { MockInvoiceClient, MockGovernanceClient, MockReputationClient } from "@iln/mock-backend";
```

---

## Running tests

```bash
pnpm --filter @iln/mock-backend test
```

---

## How writes work

All mutating operations update in-memory state and return a synthetic 64-character hex transaction hash. State resets on every process restart. There is no persistence layer by design — the mock is intended for interactive development and test suites only.

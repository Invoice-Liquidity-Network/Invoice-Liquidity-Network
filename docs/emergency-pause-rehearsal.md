# Emergency Pause / Unpause Rehearsal (Issue #879)

This document records the emergency circuit-breaker rehearsal executed against
the testnet deployment created by the
[mainnet deployment dry run](mainnet-deployment-dry-run.md). The contract under
test is the deployed `invoice_liquidity` instance; the emergency controls are
`pause` / `unpause` (admin-only, see `contracts/invoice_liquidity/src/lib.rs`).

## Procedure (rehearsed on testnet)

1. **Pause**: call `pause()` as the admin. Emits a `paused` event with a
   ledger timestamp. The call is idempotent — pausing an already-paused
   contract succeeds.
2. **Verify paused**: any funding-path entry point (e.g. `fund_invoice`,
   `submit_invoice`, `update_invoice`, `transfer_invoice`) returns
   `ContractError::ContractPaused` (`#26`) **before** touching state.
3. **Recover**: call `unpause()` as the admin. Emits an `unpaused` event.
4. **Verify recovered**: the same entry points behave normally again.
5. **Authorization**: a non-admin `pause()` attempt is rejected by the network
   (`require_admin` + `Address::require_auth`).

## Rehearsal results (2026-08-26)

Contract: `CBDCIJ5Y2CMSG7YNQQCKK32GO7KBBMHKVM7WQKNRAAX3KV6Z4LARVQVI` (testnet).

| Check | Result |
| --- | --- |
| `initialize` as admin | PASS (tx confirmed) |
| `fund_invoice` before pause (sim) | PASS — error `#1 InvoiceNotFound` (not paused) |
| `pause` as admin | PASS (tx confirmed, `paused` event) |
| `fund_invoice` while paused (sim) | PASS — error `#26 ContractPaused` |
| `pause` again while paused | PASS (idempotent) |
| `unpause` as admin | PASS (tx confirmed, `unpaused` event) |
| `fund_invoice` after unpause (sim) | PASS — error `#1 InvoiceNotFound` (recovered) |
| `pause` as non-admin | PASS — transaction rejected |
| Contract state after rejected pause | PASS — still unpaused |

9/9 checks passed. The sim-based discriminator (`fund_invoice` error `#26`
vs `#1`) verifies the pause bit without needing complex invoice arguments.

## Blocking bug found and fixed

The rehearsal could not start until the `initialize` export collision was
fixed (the deployed contract could not be initialized at all). See the
[root cause + fix in the dry-run record](mainnet-deployment-dry-run.md#blocker-found-and-fixed-initialize-export-collision)
and backend PR [ILN-Smart-Contract#756](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/pull/756).

## Production checklist

- [ ] Pause/unpause exercised on **testnet** after every contract upgrade
      (regression gate before mainnet).
- [ ] Admin key custody documented for emergency responders (multi-sig quorum,
      timelock — see [governance guide](governance-guide.md#production-multi-sig-admin-configuration)).
- [ ] Monitoring alerts wired to the `paused` / `unpaused` events so an
      emergency pause is visible to the on-call responder.
- [ ] Rehearse pause for the settlement, indexer, and notification delivery
      paths (contract-level funding path covered here; service-level paths are
      tracked in the [mainnet launch checklist](mainnet-launch-checklist.md#contracts)).

## Related

- Issue: [#879](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/879)
- Dry run + IDs: [mainnet-deployment-dry-run.md](mainnet-deployment-dry-run.md)

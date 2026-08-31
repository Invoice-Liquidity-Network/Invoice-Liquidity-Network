# `@iln/upgrade-tests`

Upgrade compatibility test harness and verification suites for Soroban smart contract upgrades, storage schema migrations, authorization controls, and SDK forward/backward compatibility.

## Purpose

Contract upgrade safety is a critical protocol requirement on Stellar/Soroban. This package provides:

1. **Contract In-Place Upgrade Simulator**: Exercises WASM bytecode swaps, entry point authorization checks (only admin can upgrade), and custom migration hooks.
2. **Persistent Storage & Schema Evolution Integrity**: Tests that existing storage records (e.g. invoices funded or pending in v1) are preserved without storage layout collision, and that upgraded v2 contracts gracefully default new optional fields (auctions, whitelist, disputes).
3. **SDK Forward & Backward Compatibility Verification**: Ensures older SDK clients continue functioning against upgraded contracts (forward compatibility) and newer SDK clients gracefully handle legacy contracts via semantic capability negotiation (backward compatibility).
4. **Emergency Pause & Circuit Breaker Preservation**: Ensures paused state is strictly maintained across in-place WASM upgrades until explicitly unpaused by the admin.

## Structure

- `src/types.ts`: Domain models for contract versions, storage schemas (V1 vs V2), upgrade options, and compatibility reports.
- `src/harness.ts`: `UpgradeTestHarness` providing an isolated, deterministic simulation environment.
- `src/contract-upgrade.test.ts`: Tests for contract upgrade flows, admin authorization, and schema evolution.
- `src/sdk-compatibility.test.ts`: Tests for SDK version comparison and forward/backward interoperability.
- `src/storage-integrity.test.ts`: Tests for Instance vs Persistent storage key collisions and bulk migration of 100+ records.
- `src/authorization-and-emergency.test.ts`: Tests for admin key rotation and circuit breaker pause preservation across upgrades.

## Running Tests

```bash
# Run unit tests
pnpm --filter @iln/upgrade-tests test

# Type check
pnpm --filter @iln/upgrade-tests type-check
```

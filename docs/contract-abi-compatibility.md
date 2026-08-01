# Contract ABI Compatibility Check — Issue #806

## Overview

This document describes the cross-cutting compatibility check that ensures the
SDK, CLI, and indexer stay in sync with the deployed smart contract ABI/spec.

## Current State

The contract spec artifact (`docs/contract-spec.json`) is tracked as a
contract-repo issue and is not yet available. Once the contract repo publishes
the spec JSON, this check will be wired into CI.

## Planned Implementation

A test in `tests/contract-abi-compat.test.ts` will:

1. Load `docs/contract-spec.json` (or generate it from the WASM if unavailable).
2. Parse the contract's exported methods and types.
3. Cross-check against:
   - `packages/sdk/src/clients/InvoiceClient.ts` — method names and signatures
   - `cli/src/commands/*` — command definitions and flags
   - `indexer/src/event-parsers/*` — event parsing logic
4. Fail loudly if any consumer drifts from the spec.

## CI Trigger

The check runs when:
- `docs/contract-spec.json` changes
- `packages/sdk/src/clients/**` changes
- `cli/src/**` changes
- `indexer/src/**` changes

## Interim Baseline

Until the contract spec is available, this directory contains only this
documentation. The test will be enabled via a feature flag once the underlying
artifact exists.
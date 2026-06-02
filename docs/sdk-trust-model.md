# SDK Trust Model

This document explains the trust assumptions and validation behavior for `@invoice-liquidity/sdk`.
It is intended for integrators who need to understand what the SDK checks, what it delegates, and what must be protected outside the SDK.

## What the SDK validates

- **Stellar address format**
  - The SDK converts addresses using `Address.fromString(address)` before contract invocation.
  - Invalid Stellar account IDs are rejected at the SDK boundary before transaction simulation.

- **Input serialization**
  - Numeric fields such as `amount`, `dueDate`, and `discountRate` are converted to Soroban SCVals.
  - The SDK enforces TypeScript types for common payload shapes, but type safety is only compile-time.

- **Signer identity checks**
  - State-changing operations verify the signer public key matches the expected `freelancer`, `funder`, or payer address when required.
  - This prevents SDK calls from being signed by the wrong account.

## What the SDK does not validate

- **Payer solvency or off-chain funds**
  - The SDK does not verify whether a payer has sufficient balance outside of contract state.
  - It does not validate external financial agreements, creditworthiness, or off-chain payment commitments.

- **Oracle or external data**
  - Any off-chain evidence, price feeds, or external validation required by business logic is outside the SDK.
  - The SDK only packages the transaction and relies on the contract and network to evaluate observable state.

- **Contract policy rules and token allowlists**
  - The SDK does not independently maintain the contract token allowlist or business rule enforcement.
  - Token authorization, amount ranges, discount rate limits, and approval logic are enforced by the contract and the RPC node during simulation/submission.

- **Complete semantic validation**
  - The SDK validates low-level input shape and address format, but it is not a complete policy engine.
  - It does not validate whether a transaction is semantically correct for your application beyond the contract invocation.

## What the SDK trusts

- **Soroban RPC node**
  - The SDK depends on `server.simulateTransaction(...)`, `server.prepareTransaction(...)`, `server.sendTransaction(...)`, and `server.pollTransaction(...)`.
  - All contract simulation, transaction preparation, and submission status are trusted to the RPC node.

- **Horizon/RPC account state**
  - Source account lookup uses `server.getAccount(address)` and trusts the node's account snapshot.
  - If the node is compromised, the SDK may build transactions from stale or invalid account state.

- **Transaction signer**
  - The SDK trusts the signer implementation returned by `createKeypairSigner`, `createFreighterSigner`, or any custom `TransactionSigner`.
  - Signing is delegated to the secure private key holder; the SDK does not inspect or validate secret keys.

- **Network configuration and contract ID**
  - The SDK trusts the `contractId`, `rpcUrl`, and `networkPassphrase` provided in configuration.
  - It does not verify that the contract address belongs to the genuine Invoice Liquidity Network deployment.

## Trust levels by component

- **SDK input validation**: Low-to-moderate trust
  - Addresses are checked for format, but contract rules and business semantics are not fully validated.

- **Soroban RPC node**: High trust
  - The SDK relies on the node for correct simulation results, XDR transaction preparation, and final transaction status.

- **Horizon RPC/account service**: High trust
  - Account state and transaction submission rely on a trusted Stellar network endpoint.

- **Signer implementation**: High trust
  - Private key handling and XDR signing must be secure and trusted.

- **Contract logic**: High trust
  - Business rules, token allowlists, and amount constraints are enforced by the deployed contract.

## Recommended best practices

- Use a dedicated Soroban RPC / Horizon node for production workloads.
  - Dedicated nodes reduce risk of shared or misconfigured infrastructure leaking stale or incorrect state.

- Verify transaction simulation before signing and sending.
  - The SDK uses simulation to expose contract errors before signing, but client code should inspect simulation results and handle failures explicitly.

- Never expose secret keys to frontend code.
  - Use browser-safe signing providers such as Freighter and keep `createKeypairSigner` secrets on backend services only.

- Validate application-level business data before passing it to the SDK.
  - Check invoice amounts, due dates, and counterparty addresses in your own code to avoid invalid user input.

- Confirm `contractId` and `networkPassphrase` are correct for your deployment.
  - A wrong contract ID or network configuration can cause the SDK to target the wrong Soroban contract.

## Security notes on XDR serialization

- The SDK serializes transactions to XDR for signing and submission.
  - Raw XDR is treated as the canonical transaction format between the SDK and signer.

- Do not trust XDR payloads received from untrusted sources.
  - Only sign XDR generated by your own SDK instance or a trusted client-side provider.

- `TransactionBuilder.fromXDR(...)` is used internally to rehydrate signed transactions.
  - This call assumes the transaction belongs to the configured network passphrase.

- Avoid exposing signed XDR in insecure logs, browser storage, or third-party channels.
  - Signed transactions can be submitted or replayed if intercepted before network submission.

## Summary

`@invoice-liquidity/sdk` is a thin wrapper that:

- validates low-level address format and request shape,
- delegates most business-rule enforcement to the deployed Soroban contract,
- and depends on trusted RPC/Horizon nodes and signer implementations for correctness.

Integrators should treat the SDK as a client-side helper, not a security boundary for business or off-chain validation.

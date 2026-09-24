# SDK Error Code Catalog

This reference documents all structured error codes produced by the `@iln/sdk` package. Every consumer-facing error thrown or returned by the SDK inherits from [`ILNError`](../sdk/src/errors.ts) and contains machine-readable fields (`code`, `message`, `remediation`, `docsUrl`, `context`, `retryable`).

---

## Error Codes

### `invalid_discount_rate`
- **Class:** `InvalidDiscountRateError`
- **Code:** `INVALID_DISCOUNT_RATE`
- **Description:** Thrown when the provided invoice discount rate is outside protocol limits or malformed.
- **Retryable:** `false`
- **Remediation:** Check `discountRate` is within bounds (`getProtocolConfig().maxDiscountRate`). If using basis points, ensure the value is in bps (e.g. 300 = 3%).

---

### `token_mismatch`
- **Class:** `TokenMismatchError`
- **Code:** `TOKEN_MISMATCH`
- **Description:** Thrown when the token contract address specified in a transaction does not match the token contract configured for the invoice or protocol.
- **Retryable:** `false`
- **Remediation:** Verify that the token contract ID/address used to build the transaction matches the token configured for the invoice/protocol.

---

### `payer_reputation_too_low`
- **Class:** `PayerReputationTooLowError`
- **Code:** `PAYER_REPUTATION_TOO_LOW`
- **Description:** Thrown when the designated payer does not satisfy the protocol's minimum reputation score requirement.
- **Retryable:** `false`
- **Remediation:** Verify the payer reputation score and select an eligible payer or request a reputation re-evaluation.

---

### `insufficient_balance`
- **Class:** `InsufficientBalanceError`
- **Code:** `INSUFFICIENT_BALANCE`
- **Description:** Thrown when the account balance is insufficient to cover transaction amounts or fee reserves.
- **Retryable:** `true`
- **Remediation:** Ensure the account has enough funds (including transaction fees) before retrying. On testnet, use `iln dev seed` to request funds.

---

### `network_error`
- **Class:** `NetworkError`
- **Code:** `NETWORK_ERROR`
- **Description:** Thrown when an HTTP or RPC connection to the Stellar Horizon / Soroban RPC node fails or times out.
- **Retryable:** `true`
- **Remediation:** Check `rpcUrl`, verify network connectivity, and confirm the RPC node status.

---

### `transaction_failed`
- **Class:** `TransactionFailedError`
- **Code:** `TRANSACTION_FAILED`
- **Description:** Thrown when a transaction fails execution on-chain after submission.
- **Retryable:** `false`
- **Remediation:** Review transaction parameters, inspect invoice state, and check fee/resource allocations.

---

### `validation_error`
- **Class:** `ValidationError`
- **Code:** `VALIDATION_ERROR`
- **Description:** Thrown when SDK parameter validation fails before sending requests.
- **Retryable:** `false`
- **Remediation:** Inspect input values and use `Validators` utilities to identify constraint violations.

---

### `wallet_not_connected`
- **Class:** `WalletNotConnectedError`
- **Code:** `WALLET_NOT_CONNECTED`
- **Description:** Thrown when a transaction signer is required but missing or unauthenticated.
- **Retryable:** `false`
- **Remediation:** Ensure a valid `signer` (e.g. keypair signer or Freighter wallet adapter) is provided in `ILNSdk` configuration.

---

### `contract_error`
- **Class:** `GenericContractError`
- **Code:** `CONTRACT_ERROR`
- **Description:** Thrown when a smart contract reverts with an unclassified custom error code or panic.
- **Retryable:** `false`
- **Remediation:** Inspect `context.rawError` and `context.matchedSignature` for raw contract error output.

---

### `simulation_failed`
- **Class:** `SimulationError`
- **Code:** `SIMULATION_FAILED`
- **Description:** Thrown when transaction pre-flight simulation fails before submission.
- **Retryable:** `false`
- **Remediation:** Ensure contract state is consistent and parameters match on-chain preconditions.

---

### `invalid_amount`
- **Class:** `InvalidAmountError`
- **Code:** `INVALID_AMOUNT`
- **Description:** Thrown when an amount, token decimal count, basis point value, or related numeric input is malformed or outside the supported range (e.g. negative amounts, excess precision, mismatched token decimals, zero denominators in `scaledMultiply`).
- **Retryable:** `false`
- **Remediation:** Fix the amount input. Amounts must be non-negative decimal values within the token's precision (`0–18` decimals).

---

### `invalid_contract_response`
- **Class:** `InvalidContractResponseError`
- **Code:** `INVALID_CONTRACT_RESPONSE`
- **Description:** Thrown when a contract or RPC response cannot be parsed into the expected SDK shape — wrong field types, missing fields (`Protocol config is missing ...`), out-of-range enum values (`Unknown invoice status ...`), or unexpected payloads (`Contract returned an invalid protocol config payload.`).
- **Retryable:** `false`
- **Remediation:** Verify the deployed contract version matches the SDK version. Inspect `context` for the offending field/value.

---

### `transaction_build_error`
- **Class:** `TransactionBuildError`
- **Code:** `TRANSACTION_BUILD_ERROR`
- **Description:** Thrown when a transaction cannot be assembled — wrong number of operations, missing `invokeHostFunction` operation, unsupported proposal action/topic, or missing `invokeContract` host function.
- **Retryable:** `false`
- **Remediation:** Review the operation list and the contract ABI used to build the transaction.

---

### `notifications_api_error`
- **Class:** `NotificationsApiError`
- **Code:** `NOTIFICATIONS_API_ERROR`
- **Description:** Thrown when the ILN notifications API (email/webhook subscriptions) rejects a request.
- **Retryable:** `true`
- **Remediation:** Verify notification endpoints, payload, and service availability.

---

### `plugin_error`
- **Class:** `PluginError`
- **Code:** `PLUGIN_ERROR`
- **Description:** Thrown when a plugin registry operation fails — plugin already registered, not registered, not loaded, or metric/widget not found.
- **Retryable:** `false`
- **Remediation:** Check the plugin id/name, registration state, and metric/widget availability.

---

### `offline_queue_full`
- **Class:** `OfflineQueueFullError`
- **Code:** `OFFLINE_QUEUE_FULL`
- **Description:** Thrown when the offline queue reaches its maximum capacity.
- **Retryable:** `false`
- **Remediation:** Process pending queued operations or increase `maxQueueSize` on the offline manager.

---

### `offline_queued`
- **Class:** `OfflineQueuedError`
- **Code:** `OFFLINE_QUEUED`
- **Description:** Thrown by SDK write methods when the offline queue is enabled and the client is offline. The operation was queued and will be resubmitted automatically when connectivity is restored.
- **Retryable:** `false`
- **Remediation:** Present the queued state to the user; the operation is retried automatically. Inspect `context.item.id` to track it.

---

### `federation_resolution_failed`
- **Class:** `FederationResolutionError`
- **Code:** `FEDERATION_RESOLUTION_FAILED`
- **Description:** Thrown when a Stellar Federation address cannot be resolved (invalid format, address not registered, or server error).
- **Retryable:** `false`
- **Remediation:** Verify the Federation address format (`name*domain`) and that the address is registered with the hosting domain.

---

## Internal Codes

### `unexpected_exit`
- **Class:** `ILNError`
- **Code:** `UNEXPECTED_EXIT`
- **Description:** Defensive "should never happen" assertion inside the retry loop.
- **Retryable:** `false`
- **Remediation:** Report as a bug; the SDK invariant was violated.

---

## Worked Example: Handling SDK Errors

```typescript
import { ILNSdk, normalizeError, ILNError } from '@iln/sdk';

const sdk = new ILNSdk({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
});

try {
  await sdk.submitInvoice({
    amount: '1000000',
    discountRate: 15000, // Invalid: exceeds max discount rate
    payer: 'GBRPYHIL2CI3FNQ4BXLFMNDLFIMTXHRGY2TEWLYYACGNDWDRV4TVTBU5',
  });
} catch (err: unknown) {
  // Normalize any caught exception to a consistent ILNError
  const ilnErr: ILNError = normalizeError(err, 'SUBMIT_INVOICE_FAILED');

  console.error(`[Error ${ilnErr.code}]: ${ilnErr.message}`);
  console.error(`Remediation: ${ilnErr.remediation}`);
  if (ilnErr.docsUrl) {
    console.error(`Documentation: ${ilnErr.docsUrl}`);
  }

  if (ilnErr.retryable) {
    console.log('This error is retryable. Retrying in 2 seconds...');
  }
}
```

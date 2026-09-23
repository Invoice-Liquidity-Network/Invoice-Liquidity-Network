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

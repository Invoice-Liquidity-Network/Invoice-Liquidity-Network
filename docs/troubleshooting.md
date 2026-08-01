# Troubleshooting Guide

This guide covers common issues and their solutions when working with the Invoice Liquidity Network SDK, CLI, and smart contracts.

For programmatic error handling and remediation steps, see [ILN SDK Error Codes](errors.md).


## Connection Issues

### RPC Server Unreachable

**Symptom:** `NetworkError: Network request failed` or `ECONNREFUSED`

**Solutions:**

1. Verify the RPC URL in your configuration:
   ```bash
   iln config
   ```

2. Test connectivity manually:
   ```bash
   curl -s https://soroban-testnet.stellar.org/health
   ```

3. Check if you're using the correct network endpoint:
   - Testnet: `https://soroban-testnet.stellar.org`
   - Mainnet: `https://soroban-mainnet.stellar.org`

4. If behind a firewall, ensure port 443 is open.

### RPC Request Timeout

**Symptom:** `TimeoutError: simulateTransaction timed out after 15000ms`

**Solutions:**

1. Increase timeout in your SDK configuration:
   ```typescript
   const sdk = new ILNSdk({
     rpcUrl: "...",
     contractId: "...",
     networkPassphrase: "...",
     timeouts: {
       readMs: 20_000,
       writeMs: 60_000,
       simulationMs: 30_000,
     },
   });
   ```

2. Check network stability and latency to the RPC server.

3. Try again during off-peak hours if the network is congested.

### DNS Resolution Failure

**Symptom:** `ENOTFOUND` or `getaddrinfo` errors

**Solutions:**

1. Verify DNS resolution:
   ```bash
   nslookup soroban-testnet.stellar.org
   ```

2. Check your DNS configuration or try alternative DNS servers.

3. Ensure you have internet connectivity.

## Transaction Failures

### Simulation Failed

**Symptom:** `SimulationError: Transaction simulation failed`

**Solutions:**

1. Check account balance:
   ```bash
   iln list --address <your-address>
   ```

2. Verify contract state:
   ```bash
   iln status --id <invoice-id>
   ```

3. Ensure all parameters are valid (amounts, addresses, dates).

4. Use `forceSubmit` to bypass simulation if you're confident the transaction will succeed:
   ```typescript
   const builder = new ILNTransactionBuilder(rpcClient);
   const { transaction } = await builder.forceSubmit(operations, config);
   ```

### Insufficient Balance

**Symptom:** `InsufficientBalanceError: Insufficient balance to complete the transaction`

**Solutions:**

1. Check your XLM balance:
   ```bash
   iln list --address <your-address>
   ```

2. Fund your account on testnet:
   ```bash
   iln dev seed --scenario new-user
   ```

3. Ensure you have enough XLM for transaction fees (typically 0.0001 XLM per operation).

### Invalid Discount Rate

**Symptom:** `InvalidDiscountRateError: Invalid discount rate provided`

**Solutions:**

1. Check the protocol configuration for allowed discount rates:
   ```bash
   iln config
   ```

2. Ensure the discount rate is within bounds (typically 0-10000 basis points).

3. Use basis points (e.g., 500 = 5%).

### Token Mismatch

**Symptom:** `TokenMismatchError: Token mismatch in transaction`

**Solutions:**

1. Verify the token contract ID matches the one configured in the protocol.

2. Check that the token is listed:
   ```bash
   iln config
   ```

3. Ensure you're using the correct token for the invoice.

### Transaction Expired

**Symptom:** `TransactionFailedError: Transaction did not succeed. Final status: EXPIRED`

**Solutions:**

1. Increase the transaction timeout:
   ```typescript
   const txBuilder = new TransactionBuilder(account, {
     fee: "100",
     networkPassphrase: "...",
   }).setTimeout(60); // 60 seconds instead of default 30
   ```

2. Resubmit the transaction promptly.

3. Check network congestion.

### Resource Fee Exceeded

**Symptom:** `TransactionFailedError: transaction fee exceeds configured maximum`

**Solutions:**

1. Check simulation results to see the required fee:
   ```typescript
   const { simulation } = await builder.buildTransaction(operations, config);
   console.log("Required fee:", simulation.minResourceFee);
   ```

2. Increase `maxFee` in your transaction configuration.

3. Reduce the number of operations in batch transactions.

## Wallet Integration Issues

### Wallet Not Connected

**Symptom:** `WalletNotConnectedError: A transaction signer is required`

**Solutions:**

1. Ensure a signer is configured:
   ```typescript
   const sdk = new ILNSdk({
     signer: createKeypairSigner(secretKey),
     // ...
   });
   ```

2. For browser apps, use Freighter:
   ```typescript
   import { createFreighterSigner } from "@iln/sdk";
   const signer = createFreighterSigner();
   ```

3. Check that Freighter extension is installed and unlocked.

### Wrong Signer Address

**Symptom:** `ValidationError: submitInvoice must be signed by the freelancer address`

**Solutions:**

1. Verify the signer address matches the expected role:
   ```typescript
   const address = await signer.getPublicKey();
   console.log("Signer address:", address);
   ```

2. Use the correct account for the operation:
   - `submitInvoice`: Must be signed by the freelancer
   - `fundInvoice`: Must be signed by the funder
   - `markPaid`: Must be signed by the payer

### Freighter Not Available

**Symptom:** `Freighter is not installed or not accessible`

**Solutions:**

1. Install the Freighter browser extension from [freighter.app](https://freighter.app).

2. Ensure the extension is enabled in your browser.

3. Unlock the extension and select the correct network.

## Network Issues

### Wrong Network Passphrase

**Symptom:** Transactions fail with signature verification errors

**Solutions:**

1. Verify you're using the correct network passphrase:
   - Testnet: `Test SDF Network ; September 2015`
   - Mainnet: `Public Global Stellar Network ; September 2015`

2. Check your configuration:
   ```bash
   iln config
   ```

3. Ensure all components (SDK, CLI, contracts) use the same network.

### Account Not Found

**Symptom:** `Account not found` or 404 errors

**Solutions:**

1. Ensure the account exists on the network:
   ```bash
   iln list --address <address>
   ```

2. Fund the account on testnet:
   ```bash
   iln dev seed
   ```

3. Verify you're querying the correct network.

### Contract Not Deployed

**Symptom:** `Contract not found` or simulation errors

**Solutions:**

1. Check the contract ID in your configuration.

2. Deploy the contract locally:
   ```bash
   iln dev start
   ```

3. Verify the contract exists on the network.

## Development Issues

### Docker Not Running

**Symptom:** `docker: command not found` or Docker connection errors

**Solutions:**

1. Install Docker Desktop from [docker.com](https://docker.com).

2. Start Docker Desktop.

3. Verify Docker is running:
   ```bash
   docker ps
   ```

### Local Environment Won't Start

**Symptom:** `iln dev start` fails

**Solutions:**

1. Check Docker is running:
   ```bash
   docker info
   ```

2. Reset the environment:
   ```bash
   iln dev reset
   ```

3. Check logs:
   ```bash
   docker logs stellar
   ```

4. Ensure ports 8000, 8080 are not in use:
   ```bash
   lsof -i :8000
   ```

### Contract Deployment Failed

**Symptom:** `iln dev start` fails during contract deployment

**Solutions:**

1. Ensure the Stellar CLI is installed:
   ```bash
   stellar version
   ```

2. Check the contract WASM files exist in the `contracts/` directory.

3. Try deploying manually:
   ```bash
   stellar contract deploy --wasm contracts/invoice.wasm --network standalone
   ```

### Testnet Seeding Failed

**Symptom:** `iln dev seed` fails

**Solutions:**

1. Ensure you have testnet XLM in your funding account.

2. Check network connectivity to Friendbot:
   ```bash
   curl https://friendbot.stellar.org/?addr=<address>
   ```

3. Verify token contract IDs are correct for testnet.

### TypeScript Compilation Errors

**Symptom:** `tsc` or build fails

**Solutions:**

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Check TypeScript version:
   ```bash
   npx tsc --version
   ```

3. Verify `tsconfig.json` is correct.

4. Clear build artifacts:
   ```bash
   rm -rf dist/ node_modules/.cache
   pnpm install
   ```

## Performance Issues

### Slow RPC Responses

**Solutions:**

1. Use a dedicated RPC endpoint instead of public ones.

2. Implement request caching for read operations.

3. Use batch operations for multiple transactions:
   ```typescript
   const batch = await sdk.batch([
     sdk.buildSubmitInvoiceOperation(params1),
     sdk.buildSubmitInvoiceOperation(params2),
   ]);
   ```

4. Monitor response times:
   ```typescript
   console.time("rpc-call");
   await sdk.getInvoice(invoiceId);
   console.timeEnd("rpc-call");
   ```

### Memory Issues with Large Event Streams

**Solutions:**

1. Use event filters to reduce processed events.

2. Implement proper cleanup:
   ```typescript
   const unsubscribe = sdk.subscribeToInvoice(id, callback);
   // Later:
   unsubscribe();
   ```

3. Limit event history size:
   ```typescript
   const emitter = sdk.createEventEmitter({ maxHistorySize: 50 });
   ```

## Getting Help

If you encounter issues not covered here:

1. Check the [GitHub Issues](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues) for similar problems.

2. Review the [SDK API Reference](sdk-api-reference.md).

3. Join the community Discord for real-time support.

4. File a new issue with:
   - Error message and stack trace
   - SDK and CLI versions
   - Network (testnet/mainnet)
   - Steps to reproduce

# `@invoice-liquidity/cli`

Command-line interface for common Invoice Liquidity Network contract operations on Stellar.

By participating in this project, you agree to abide by our [Code of Conduct](../CODE_OF_CONDUCT.md).

## Install

```bash
npm install -g @invoice-liquidity/cli
```

This publishes the `iln` binary.

## Configuration

Create a `.iln.json` file in your working directory:

```json
{
  "network": "testnet",
  "contractId": "CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC",
  "tokenId": "CDUMMYYOURTOKENIDHERE",
  "keypairPath": "~/.config/iln/freelancer.secret"
}
```

Supported keys:

- `network`: `testnet`, `mainnet`, or `standalone`
- `contractId`: ILN contract ID
- `tokenId`: default token contract to use for `submit`
- `keypairPath`: path to a file containing a Stellar secret key
- `rpcUrl`: optional RPC override
- `networkPassphrase`: optional passphrase override

Environment fallbacks:

- `ILN_NETWORK`
- `ILN_CONTRACT_ID`
- `ILN_TOKEN_ID`
- `ILN_KEYPAIR_PATH`
- `ILN_RPC_URL`
- `ILN_NETWORK_PASSPHRASE`

## Commands

### Local Development Environment

```bash
iln dev start
iln dev status
iln dev stop
iln dev reset
```

- `start` launches the local Stellar quickstart Docker container, registers the local network, creates/funds development keys, deploys a built ILN WASM when available, and writes `.env.local`.
- `stop` removes the local quickstart container.
- `reset` removes local generated state and starts fresh.
- `status` prints node, RPC, contract, and token state.

Requires Docker to be installed and running. Contract deployment also requires the Stellar CLI and a built contract WASM.

### Submit

```bash
iln submit --payer G... --amount 100 --due 2025-12-31 --rate 300
```

- `--amount` uses display units and is converted to Stellar stroops internally.
- `--due` accepts either `YYYY-MM-DD` or a Unix timestamp.
- `--token` can override the configured `tokenId` if needed.

### Fund

```bash
iln fund --id 1
```

By default this funds the remaining balance on the invoice. To partially fund:

```bash
iln fund --id 1 --amount 25
```

### Pay

```bash
iln pay --id 1
```

### Status

```bash
iln status --id 1
```

### List

```bash
iln list --address G...
```

This lists invoices where the address is the freelancer, payer, or recorded funder.

### Development - Testnet Account Seeder

```bash
iln dev seed
```

Creates and funds 3 development accounts (freelancer, payer, liquidity_provider) on testnet with USDC/EURC trustlines configured. Fully idempotent - running multiple times reuses existing accounts.

**Output:**
- Generates keypairs for 3 accounts
- Funds each via Friendbot with XLM
- Sets up USDC and EURC trustlines
- Saves account details to `.env.testnet.accounts` (gitignored)

**Requires:** Active internet connection and testnet network configuration.

For detailed setup instructions, see [SEEDER.md](./SEEDER.md).

## Local integration testing

The integration suite is designed for the repository's standalone Soroban environment.

1. Start the local network:

```bash
docker-compose up -d
```

2. Deploy and seed the contract.

3. Export the local fixture values:

```bash
export ILN_CLI_LOCAL_CONTRACT_ID=...
export ILN_CLI_LOCAL_TOKEN_ID=...
export ILN_CLI_LOCAL_FREELANCER_SECRET=...
export ILN_CLI_LOCAL_FREELANCER_PUBLIC_KEY=...
export ILN_CLI_LOCAL_PAYER_SECRET=...
export ILN_CLI_LOCAL_PAYER_PUBLIC_KEY=...
export ILN_CLI_LOCAL_FUNDER_SECRET=...
```

4. Run the integration suite:

```bash
cd cli
npm run test:integration
```

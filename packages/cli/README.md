# @iln/cli

Command-line interface for the Invoice Liquidity Network.

## Installation

```bash
pnpm install -g @iln/cli
```

## Configuration

Config values are loaded with the following precedence:
1. Environment variables
2. Configuration file at `~/.iln/config.json`

### Environment Variables

- `ILN_NETWORK`: `"testnet"` or `"mainnet"`
- `ILN_SECRET_KEY`: Stellar secret key for signing state-changing transactions.
- `ILN_CONTRACT_ID`: Stellar contract ID of the ILN contract.

### Config File

The configuration file is JSON-formatted and stored at `~/.iln/config.json`:

```json
{
  "network": "testnet",
  "secretKey": "S...",
  "contractId": "C..."
}
```

## Commands

### Switch Active Network
```bash
iln network switch <testnet|mainnet>
```

### Submit a New Invoice
```bash
iln invoice submit --payer <address> --amount <amount> --due-date <date> --discount-rate <rate> [--freelancer <address>]
```

### Fund an Invoice
```bash
iln invoice fund --id <invoiceId> [--funder <address>]
```

### Pay an Invoice
```bash
iln invoice pay --id <invoiceId>
```

### Get Invoice Details
```bash
iln invoice get <invoiceId>
```

### List Invoices
```bash
iln invoice list [--address <address>]
```

### Show Protocol Stats
```bash
iln stats
```

### Get Reputation Score
```bash
iln reputation get [address]
```

Use the global `--json` flag to return machine-readable JSON:
```bash
iln invoice get 1 --json
```

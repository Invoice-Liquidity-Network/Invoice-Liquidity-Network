# Testnet Account Seeder

For general CLI documentation and other commands, see [README.md](./README.md).

## Overview

The testnet account seeder (`iln dev seed`) automates the setup of development accounts on Stellar testnet. It creates three funded accounts with USDC and EURC trustlines configured, eliminating the need for manual account creation and trustline setup.

## Features

- **Automatic Account Generation**: Creates 3 new testnet accounts (freelancer, payer, liquidity_provider)
- **Friendbot Funding**: Funds accounts via Friendbot with test XLM
- **Trustline Setup**: Automatically configures USDC and EURC trustlines
- **Idempotent**: Running the command multiple times reuses existing accounts instead of creating duplicates
- **Environment Export**: Saves account details to `.env.testnet.accounts` (gitignored) for reference

## Usage

### Basic Command

```bash
iln dev seed
```

This command will:
1. Check if accounts already exist (idempotency)
2. Generate 3 new keypairs if needed
3. Fund each account via Friendbot
4. Set up USDC and EURC trustlines
5. Save account details to `.env.testnet.accounts`
6. Display a summary table of created accounts

### Example Output

```
Creating 3 testnet accounts...
Funding accounts via Friendbot...
  ✓ Funded freelancer with XLM
  ✓ Funded payer with XLM
  ✓ Funded liquidity_provider with XLM
Setting up USDC and EURC trustlines...
  ✓ Added USDC trustline for freelancer
  ✓ Added EURC trustline for freelancer
  ✓ Added USDC trustline for payer
  ✓ Added EURC trustline for payer
  ✓ Added USDC trustline for liquidity_provider
  ✓ Added EURC trustline for liquidity_provider
✓ Testnet accounts seeded successfully!

  Role                  Public Key
  ────────────────────  ──────────────────────────────────
  FREELANCER            GXXX...XXXX
  PAYER                 GYYY...YYYY
  LIQUIDITY PROVIDER    GZZZ...ZZZZ
```

## Generated Files

The seeder creates `.env.testnet.accounts` with the following format:

```env
# Generated testnet accounts - DO NOT COMMIT
# Created for development purposes only
# Testnet only - no real value

TESTNET_FREELANCER_PUBLIC=G...
TESTNET_FREELANCER_SECRET=S...

TESTNET_PAYER_PUBLIC=G...
TESTNET_PAYER_SECRET=S...

TESTNET_LIQUIDITY_PROVIDER_PUBLIC=G...
TESTNET_LIQUIDITY_PROVIDER_SECRET=S...

# Token contract addresses on Stellar testnet
TESTNET_USDC_ISSUER=GBUQWP3BOUZX34TBIGK5ILGKDFHTQCXY4IQ7ZLVTLZHVNCV3XVJVTSC
TESTNET_EURC_ISSUER=GCNY5OXYSY4FZLQS2B4J5NE6BNUL37AJQ4NZ4PROUGH6TWYJF6XZMFC
```

**Note**: This file is gitignored and contains secret keys. Never commit it to version control.

## Minting Test Tokens

After account setup, you need to mint test tokens. You can do this in one of two ways:

### Option 1: Using Stellar Expert (GUI)
1. Visit https://stellar.expert/
2. Log in with your account
3. Navigate to the USDC and EURC token pages
4. Use the minting interface if you have admin access

### Option 2: Programmatic Minting
If you have admin access to the token contracts, use the SDK to mint tokens:

```typescript
import { Keypair } from "@stellar/stellar-sdk";

const freelancerPublic = process.env.TESTNET_FREELANCER_PUBLIC;
const usdcAmount = BigInt(1000 * 1e6); // 1000 USDC

// Mint tokens using SDK (requires admin keypair)
// Implementation depends on your token contract
```

## Token Contracts (Testnet)

| Token | Issuer                                    |
|-------|-------------------------------------------|
| USDC  | `GBUQWP3BOUZX34TBIGK5ILGKDFHTQCXY4IQ7ZLVTLZHVNCV3XVJVTSC` |
| EURC  | `GCNY5OXYSY4FZLQS2B4J5NE6BNUL37AJQ4NZ4PROUGH6TWYJF6XZMFC` |

## Idempotency

The seeder is fully idempotent. If you run it multiple times:

1. **First run**: Creates accounts, funds them, sets up trustlines
2. **Subsequent runs**: Detects existing accounts and reuses them
3. **No duplicates**: Only creates accounts when `.env.testnet.accounts` is missing or incomplete

To reset and create new accounts:
```bash
rm .env.testnet.accounts
iln dev seed
```

## Troubleshooting

### Friendbot Errors
If funding fails with "Friendbot returned 400":
- Check your internet connection
- Verify the account public key is valid
- Friendbot may be rate-limited; wait a moment and try again

### Trustline Setup Failures
If trustline setup fails:
- Ensure the account is funded with XLM
- Check the token issuer address is correct
- Some errors about existing trustlines are expected and safe to ignore

### Using Created Accounts with the CLI

Once accounts are created, you can use them with other CLI commands:

```bash
# Export the environment
export ILN_KEYPAIR_PATH=~/.stellar/keys/freelancer

# Submit an invoice as freelancer
iln submit \
  --payer GXX...XX \
  --amount 1000 \
  --due 2025-12-31 \
  --rate 300
```

## Development Workflow

Typical development workflow:

```bash
# 1. Seed testnet accounts (run once)
iln dev seed

# 2. Use accounts for testing
export ILN_KEYPAIR_PATH=~/.stellar/keys/freelancer
iln submit --payer $PAYER --amount 100 --due 2025-12-31 --rate 300

# 3. List invoices
iln list --address $FREELANCER_PUBLIC

# 4. Fund invoices as LP
export ILN_KEYPAIR_PATH=~/.stellar/keys/liquidity_provider
iln fund --id 1

# 5. Mark as paid
export ILN_KEYPAIR_PATH=~/.stellar/keys/payer
iln pay --id 1
```

## Requirements

- Node.js 18+
- Internet connection (for Friendbot funding)
- Active testnet network configuration in `.iln.json` or environment

## Security Notes

⚠️ **Development Only**: These accounts and tokens are for testnet development only.
- Never use these account keypairs with real funds
- These accounts have no real value
- Do not commit `.env.testnet.accounts` to version control
- Rotate accounts regularly for security best practices

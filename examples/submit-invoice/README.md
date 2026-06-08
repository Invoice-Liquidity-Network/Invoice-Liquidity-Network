# Submit Invoice Example

This is a complete Node.js example script that demonstrates how to programmatically submit invoices using the Invoice Liquidity Network (ILN) SDK.

## Features

- Load configuration from environment variables
- Validate inputs before submission
- Build and submit invoices
- Handle network errors with automatic retries
- Catch Soroban budget exceeded errors
- Handle insufficient balance errors
- Wait for transaction confirmation
- Display invoice details

## Setup

### 1. Install dependencies

```bash
cd examples/submit-invoice
npm install
```

### 2. Copy and fill in environment variables

```bash
cp .env.example .env
```

Then edit `.env` and fill in all the required fields:

| Variable | Description | Required |
|----------|-------------|----------|
| `FREELANCER_SECRET_KEY` | Secret key of the freelancer submitting the invoice | Yes |
| `PAYER_ADDRESS` | Public key of the payer | Yes |
| `INVOICE_AMOUNT` | Invoice amount in stroops (1 XLM = 10,000,000 stroops) | Yes |
| `INVOICE_DUE_DATE` | Due date as a Unix timestamp (seconds since epoch) | Yes |
| `INVOICE_DISCOUNT_RATE` | Discount rate in percentage (0-100) | Yes |
| `CONTRACT_ID` | ILN contract ID (defaults to testnet) | No |
| `RPC_URL` | Soroban RPC URL (defaults to testnet) | No |
| `NETWORK_PASSPHRASE` | Network passphrase (defaults to testnet) | No |

### 3. Generate a Unix timestamp

You can use this code to generate a timestamp for the due date:

```javascript
// Due date 30 days from now
const dueDate = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
console.log(dueDate);
```

### 4. Fund your account (Testnet)

Make sure your freelancer account has enough XLM to cover fees. You can fund testnet accounts using the [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test).

## Usage

```bash
npm start
```

## Script Details

The script does the following:

1. **Validate Configuration**: Ensures all required environment variables are present and valid
2. **Create Signer**: Uses the secret key to create a transaction signer
3. **Initialize SDK**: Creates an ILN SDK instance with the specified network settings
4. **Submit Invoice**: Calls `sdk.submitInvoice()` with the invoice parameters
5. **Handle Retries**: Retries up to 3 times for network errors
6. **Display Results**: Shows the invoice ID and details upon success
7. **Handle Errors**: Provides specific error messages for common issues like budget exceeded or insufficient balance

## Error Handling

The script catches and handles:
- Network errors (with retries)
- Soroban budget exceeded errors
- Insufficient balance errors
- Invalid input errors

## Example Output

```
=== Invoice Submission Script ===

Configuration:
- Freelancer address: G...
- Payer address: G...
- Amount: 10000000 stroops
- Due date: 2024-07-03T01:23:45.678Z
- Discount rate: 5%
- Contract ID: CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC
- Network: Testnet

Submitting invoice...

✅ Invoice submitted successfully!
📋 Invoice ID: 123
🔗 Check on Stellar Explorer: https://stellar.expert/explorer/testnet/contract/...

Verifying invoice...
Invoice details:
{
  id: 123n,
  freelancer: 'G...',
  payer: 'G...',
  amount: 10000000n,
  dueDate: ...,
  discountRate: 5,
  status: 'Pending',
  funder: null,
  fundedAt: null
}
```

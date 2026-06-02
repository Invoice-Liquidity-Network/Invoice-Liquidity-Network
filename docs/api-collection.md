# API Collection

This document describes the Invoice Liquidity Network (ILN) Horizon and Soroban RPC collection for testnet.

The collection files are available in `examples/api-collection/`:

- `iln.bru` — Bruno-compatible collection for Horizon and Soroban RPC
- `iln.postman_collection.json` — Postman v2.1 compatible equivalent

## Supported requests

### Horizon

- `Get Account` — fetch an account from Horizon
- `Get Transactions` — list recent transactions for an account
- `Stream Contract Events` — open a Horizon event stream for the ILN contract

### Soroban RPC

- `simulateTransaction` — simulate a transaction locally
- `sendTransaction` — submit a signed transaction to testnet
- `getTransaction` — fetch transaction status by hash
- `getEvents` — query ILN contract events directly from Soroban RPC

## Included variables

The collection is pre-populated with ILN testnet network URLs and contract IDs.

- `horizon_url`: `https://horizon-testnet.stellar.org`
- `rpc_url`: `https://soroban-testnet.stellar.org`
- `iln_contract_id`: `CCPASLHKRFBMVV5PZG3LKDGKFEDXZMB5U7DK42CVLUVWCMUCSRPVBIMO`
- `distribution_contract_id`: `CAQGPMT3EQK4AABMIR66JJXEOCNCLPTDNXMS5OHZXH4LI24UYAF25V5B`
- `governance_contract_id`: `CD7GOIU3GNK7EZHG7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB`

Other variables are included as placeholders for the account and transaction details you want to inspect:

- `account_id`
- `invoice_id`
- `transaction_hash`
- `get_invoice_tx_xdr`
- `submit_invoice_tx_xdr`
- `signed_submit_invoice_tx_xdr`
- `get_events_cursor`

## Example XDR argument patterns

The collection includes example argument patterns for the two most common ILN contract calls.

### submit_invoice

A `submit_invoice` contract call requires:

- `freelancer` (`Address`)
- `payer` (`Address`)
- `amount` (`i128`)
- `due_date` (`u64`)
- `discount_rate` (`u32`)

In Stellar Soroban XDR terms, the arguments are structured like:

```json
[
  {"type": "address", "value": "G..."},
  {"type": "address", "value": "G..."},
  {"type": "i128", "value": "100000000"},
  {"type": "u64", "value": "1717065600"},
  {"type": "u32", "value": "300"}
]
```

### get_invoice

A `get_invoice` contract call requires a single invoice ID:

```json
[
  {"type": "u64", "value": "1"}
]
```

These values are represented in the collection by the `get_invoice_tx_xdr` and `submit_invoice_tx_xdr` variables, which should contain the base64-encoded unsigned transaction envelope.

## How to use

1. Open `examples/api-collection/iln.bru` in Bruno or import `examples/api-collection/iln.postman_collection.json` into Postman.
2. Replace placeholder variables such as `account_id`, `transaction_hash`, and the XDR variables with real values.
3. Use the Horizon requests to inspect on-chain accounts and transactions.
4. Use the Soroban RPC requests to simulate contract calls, submit signed transactions, and query contract events.

## Notes

- `submit_invoice` and other write requests require a properly formed signed transaction envelope.
- `simulateTransaction` can be used to validate contract invocation before submitting it.
- The collection is intentionally testnet-focused and uses the official Stellar testnet Horizon and Soroban endpoints.

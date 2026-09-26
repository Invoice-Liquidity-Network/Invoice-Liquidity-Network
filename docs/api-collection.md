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

## Indexer bulk-export resource limits

The indexer's bulk-export endpoints (`GET /v1/export/invoices`, `GET /v1/export/events`,
and the async job endpoints under `/v1/export/jobs`) stream results with true row-by-row
pagination — responses are produced from a streaming SQLite cursor, so server memory stays
flat regardless of result size. The following limits protect the process from
resource-exhaustion; every one is env-overridable and validated against the exact request.

### Hard caps (unchanged)

| Constant | Default | Behavior when exceeded |
|---|---|---|
| `SYNC` page cap | 5,000 rows | `413` on `GET /v1/export/*` — switch to an async job |
| `ASYNC` job cap | 50,000 rows | Job fails with `Result set too large` |

### Per-session budgets (streaming pagination)

A "session" is the sequence of requests needed to download one filtered export: the first
request, plus every follow-up made with the returned resumption cursor. Budgets are carried
across stateless requests inside the opaque cursor, so they hold even if intermediate
responses are dropped.

| Env var | Default | Meaning |
|---|---|---|
| `EXPORT_SESSION_MAX_ROWS` | 200,000 | Cumulative rows delivered in one session (across pages) |
| `EXPORT_SESSION_MAX_SECONDS` | 300 | Wall-clock budget per streamed response |
| `EXPORT_SESSION_MAX_BYTES` | 100,000,000 (100 MB) | Byte budget per streamed response |
| `EXPORT_PAGE_MAX_ROWS` | same as SYNC cap (5,000) | Rows per streamed page — forces mid-result cutoffs below the 413 line |

For async jobs:

| Env var | Default | Meaning |
|---|---|---|
| `EXPORT_JOB_TTL_SECONDS` | 1,800 | Finished jobs are evicted from memory after this TTL |
| `EXPORT_JOB_MAX` | 1,000 | Cap on tracked jobs; oldest finished jobs evict first |

### Truncation & resumption headers

When a session hits the row budget before the result set is exhausted (but the request is
still within the sync 413 line), the response is cut off **after a complete row** and carries:

- `X-Export-Truncated: true`
- `X-Export-Resumption-Cursor: <opaque base64 cursor>`

Resume by re-issuing the same request with `?cursor=<opaque cursor>` appended:

```bash
# first page (large export, sub-413 thanks to filters)
curl -D headers.txt "https://indexer/v1/export/invoices?format=json&status=Paid"

# if headers.txt shows X-Export-Truncated: true, continue the session:
curl -D headers.txt \
  "https://indexer/v1/export/invoices?format=json&status=Paid&cursor=$(grep -i x-export-resumption-cursor headers.txt | cut -d' ' -f2 | tr -d '\r')"
```

Repeat until `X-Export-Truncated` is absent. Resumed async jobs report `truncated` and
`resumptionCursor` in `GET /v1/export/jobs/:jobId`; the follow-up job is created by passing
`{ "cursor": "<resumptionCursor>", ... }` in the `POST /v1/export/jobs` body. If the
cumulative session row budget is exhausted, the server responds `413` with
`Export session row budget exhausted` — start a new session by omitting the cursor.

### Load test

`pnpm test:load:export` (requires a running indexer) drives concurrent streaming export
sessions, cursor pagination and async job lifecycles, and asserts error rate, p95 latency,
protocol correctness (truncated responses must carry a resumption cursor) and a server RSS
ceiling. See `scripts/load-test-indexer-export.ts` for flags.


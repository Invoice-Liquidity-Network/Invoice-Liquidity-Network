# LP Funding Automation

A Node.js script that automatically funds ILN invoices matching configurable LP criteria. Use it as a cron job or a one-shot automation template.

## Features

- Fetches pending invoices from the ILN indexer REST API
- Filters by minimum yield, maximum invoice amount, and allowed tokens
- Sorts candidates by yield (highest first) and funds the top N
- **Dry-run mode** — logs what would be funded without signing any transaction
- **Spend cap** — hard maximum total spend per run to prevent runaway funding
- Skips invoices where simulation or transaction submission fails

## Prerequisites

- Node.js ≥ 18
- A funded Stellar testnet keypair (get one via [Friendbot](https://friendbot.stellar.org))
- The ILN indexer running and accessible (or use the public testnet URL)

## Setup

```bash
cd examples/lp-automation
npm install
```

## Configuration

All runtime config is provided via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | Yes (live only) | — | Stellar secret key (`S...`) for signing |
| `INDEXER_URL` | No | `https://iln-indexer.up.railway.app` | ILN indexer base URL |
| `CONTRACT_ID` | No | Testnet default | ILN contract ID to target |

CLI flags override the built-in defaults:

| Flag | Default | Description |
|---|---|---|
| `--dry-run` | false | Preview mode — no transactions sent |
| `--top-n <n>` | 5 | Max invoices to fund per run |
| `--min-yield <bps>` | 100 | Minimum yield in basis points (100 = 1%) |
| `--max-amount <stroops>` | 100000000000 | Max invoice face value (10,000 USDC) |
| `--max-spend <stroops>` | 500000000000 | Hard spend cap per run (50,000 USDC) |

## Usage

### Dry run (no wallet required)

```bash
INDEXER_URL=https://iln-indexer.up.railway.app \
  npm run start:dry-run
```

Or with custom criteria:

```bash
ts-node index.ts --dry-run --min-yield 200 --top-n 3
```

### Live run on testnet

```bash
SECRET_KEY=SXXXXXXXXXXXX... \
INDEXER_URL=https://iln-indexer.up.railway.app \
  npm start
```

### Run as a cron job (every 5 minutes)

```cron
*/5 * * * * cd /path/to/lp-automation && SECRET_KEY=S... npm start >> /var/log/lp-automation.log 2>&1
```

## Example output

```
[2026-06-02T09:00:00.000Z] Starting LP automation. dry-run=true
[2026-06-02T09:00:00.012Z] Criteria: minYieldBps=100, maxAmount=100000000000, topN=5
[2026-06-02T09:00:00.234Z] Fetched 12 pending invoices from indexer
[2026-06-02T09:00:00.235Z] 4 invoices match criteria after filtering
[2026-06-02T09:00:00.235Z] [DRY-RUN] Would fund invoice #7  yield=300bps  amount=50000000000  cost=48500000000
[2026-06-02T09:00:00.235Z] [DRY-RUN] Would fund invoice #3  yield=250bps  amount=20000000000  cost=19500000000
[2026-06-02T09:00:00.236Z] [DRY-RUN] Would fund invoice #11 yield=200bps  amount=10000000000  cost=9800000000
[2026-06-02T09:00:00.236Z] [DRY-RUN] Would fund invoice #2  yield=150bps  amount=5000000000   cost=4925000000
[2026-06-02T09:00:00.236Z] ─── Run summary ───────────────────────────────────────
[2026-06-02T09:00:00.236Z] Total invoices evaluated : 4
[2026-06-02T09:00:00.236Z] Funded                   : 0
[2026-06-02T09:00:00.236Z] Dry-run (would fund)     : 4
[2026-06-02T09:00:00.236Z] Skipped (errors)         : 0
[2026-06-02T09:00:00.236Z] Total spent              : 82725000000 stroops
[2026-06-02T09:00:00.236Z] ───────────────────────────────────────────────────────
```

## Extending the script

- **Reputation filter** — wire `minReputation` to a reputation oracle endpoint
- **Multi-token** — populate `allowedTokens` to restrict to specific token contract addresses
- **Notifications** — call the ILN notifications SDK after each successful funding
- **Scheduling** — wrap in a `setInterval` loop instead of a one-shot script

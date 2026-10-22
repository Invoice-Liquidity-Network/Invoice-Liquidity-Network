# Indexer Operations Checks (Issue #1288)

Two controls keep the indexer's operations documentation true and its startup
fail-closed. This page says what each control is, who owns it, how to see it is
active, and how to recover when it fires.

| | Startup configuration validation | Operations docs check |
|---|---|---|
| **What** | Refuses to start the indexer on invalid configuration | Fails CI when `docs/indexer/*.md` claims something the code does not do |
| **Where** | `indexer/src/configValidation.ts`, called first by `indexer/src/index.ts` | `scripts/check-indexer-ops-docs.mjs` (`scripts/lib/indexer-ops-docs.mjs`) |
| **Runs** | Every process start, including every restart | Every PR and push to `main`/`dev` touching the indexer or its docs, plus weekly — [Indexer Ops Docs workflow](../../.github/workflows/indexer-ops-docs.yml) |
| **Owner** | `@Invoice-Liquidity-Network/indexer-team` | `@Invoice-Liquidity-Network/indexer-team`, with `@Invoice-Liquidity-Network/docs-lead` for prose |
| **Proof it is active** | `[config] OK …` log line; `iln_indexer_config_info` = 1 on `GET /metrics` | `indexer-ops-docs-report` artifact (JSON) and the job summary on every run |
| **Tests** | `indexer/tests/config-validation.test.ts` (success, failure, boundaries, restart/replay, real entry point) | `scripts/__tests__/indexer-ops-docs.test.mjs` (each rule, parsers, and the real repository) |

## Startup configuration validation

### What it guarantees

Before the HTTP port opens, the RPC node is polled or the database is opened,
the raw environment is checked against the rules in
[configuration.md → Startup validation](configuration.md#startup-validation).
All problems are reported at once. On any error the Node process exits with
code **78** (`EX_CONFIG`) and nothing is started. When launched through pnpm
(Railway's `startCommand`), pnpm logs `Command failed with exit code 78` and
itself exits 1 — search the logs for `exit code 78` or `[config] INVALID`.

Previously none of this existed although the configuration page claimed it did:
`POLL_INTERVAL_MS=5s` became `NaN` (a ~1 ms polling loop against the RPC node),
`PORT=` became a random port, a missing `CONTRACT_ID` silently indexed the
testnet contract in production, `BACKUP_ENABLED=TRUE` silently disabled
backups, and `ARCHIVE_ENABLED=False` enabled archival.

### Signals

| Signal | Meaning |
|---|---|
| Log `[config] OK network=… contract=… warnings=N` | Validation passed; values shown are what this process uses (secrets redacted) |
| Log `[config] WARN <VARIABLE> <reason>` | Started, but the setting is risky (e.g. backups off in production) |
| Log `[config] INVALID <VARIABLE> <reason>` + `exit code 78` | Refused to start (pnpm itself exits 1) |
| `iln_indexer_config_info{network, contract_id}` = 1 | This instance passed validation; labels show which network and contract it indexes |
| `iln_indexer_config_warnings` | Number of warnings at startup; alert if > 0 in production |
| Log `[poller] START_LEDGER=… ignored: resuming from stored cursor …` | Restart with an existing cursor; `START_LEDGER` only applies to an empty database |

Useful alerts:

```promql
# Indexer is up but pointed at the wrong network
iln_indexer_config_info{network!="mainnet"} == 1   # on mainnet deployments

# Production instance started with warnings
iln_indexer_config_warnings > 0
```

### Recovery

1. Read the `[config] INVALID` lines in the service logs (`railway logs`,
   `docker-compose logs indexer`). Each names the variable and the reason.
2. Fix every listed variable. The rules and ranges are in
   [configuration.md](configuration.md#startup-validation).
3. Restart. Validation runs again; a restart without a fix fails again
   identically. Railway stops after `restartPolicyMaxRetries` (3) in
   `indexer/railway.toml`, so a config error does not cause a restart storm.
4. Confirm `[config] OK` in the logs and `iln_indexer_config_info` on
   `GET /metrics`, then `GET /v1/health` returns `200`.

To check a configuration without starting the service (exit 0 when valid;
otherwise pnpm reports `exit code 78` and exits non-zero):

```bash
pnpm --filter iln-indexer exec tsx -e "import { validateIndexerEnv, reportConfigValidation } from './src/configValidation'; process.exit(reportConfigValidation(process.env, validateIndexerEnv(process.env)) ? 0 : 78)"
```

Do **not** work around an `INVALID` error by removing validation or forcing
`NODE_ENV` away from `production`; that reopens the failure modes above.

## Operations docs check

### What it guarantees

`node scripts/check-indexer-ops-docs.mjs` verifies, against the indexer source:

| Rule | Claim checked |
|---|---|
| `env-undocumented` | Every variable read via `process.env` in `indexer/src` is in a [configuration.md](configuration.md) table |
| `env-not-read` | Every variable in those tables is read by the code |
| `env-default-mismatch` | Documented defaults equal the code defaults |
| `env-reference-unknown` | `VAR=value` examples in any indexer doc set variables the indexer reads |
| `route-unknown` | Every `GET /…`, `POST /…` or `curl …:3001/…` is a real route (with method) |
| `metric-unknown` | Every `iln_*` / `indexer_*` metric name is exported by `indexer/src/metrics.ts` |
| `command-unknown` | `pnpm --filter iln-indexer …` / `npm run …` scripts and `exec` binaries exist |
| `health-contract` | Health status values in the docs are ones `/health` can return (`ok`, `error`) |
| `deploy-config` | `indexer/railway.toml` is valid TOML (no duplicate keys), its health check path and scripts exist, and its variables are read |

Baseline when introduced (#1288): **31 findings** on `dev`; **0** after this change.

### Run it

```bash
node scripts/check-indexer-ops-docs.mjs                     # human output, exit 0/1
node scripts/check-indexer-ops-docs.mjs --json=report.json  # also write the JSON report
node --test scripts/__tests__/indexer-ops-docs.test.mjs     # the guard's own tests
```

### Recovery

Each finding prints `[rule] file:line message`. Fix whichever side is wrong:

- The doc is stale → update the doc (most findings).
- The code changed a contract (renamed a variable or metric, changed a default
  or a health status) → update the docs in the same PR, and say so in the PR
  description because adjacent services may depend on it.
- A legitimate placeholder (e.g. `TARGET_LEDGER` in a command) is flagged →
  add it to `NON_CONFIG_ALLOWLIST` in `scripts/lib/indexer-ops-docs.mjs` with
  a comment, and keep the allowlist small.

Never weaken the check to make CI pass; a failing finding means an operator
following the docs would do the wrong thing.

## Compatibility

No HTTP route, response shape, metric or environment variable was renamed or
removed. Adjacent services are unaffected:

- `oracle-service` reads the indexer via `INDEXER_BASE_URL` routes, which are unchanged.
- `/health` keeps the 200/503 contract introduced for Railway (status `ok`/`error`).
- New: two metrics (`iln_indexer_config_info`, `iln_indexer_config_warnings`) and
  exit code 78. Deployments that previously started with invalid values will now
  refuse to start until the values are fixed — that is the intended fail-closed change.

# Local Development

This guide is the contributor setup for the ILN monorepo: prerequisites,
submodules, environment variables, the Docker Compose stack, per-workspace
build/run/test commands for **every** package in
[monorepo-map.md](monorepo-map.md), and OS-specific troubleshooting.

The repo is a **pnpm workspace with a single lockfile** (`pnpm-lock.yaml` at the
root). `turbo` orchestrates cross-package `build` / `test` / `lint` / `type-check`.
There are no per-package `package-lock.json` / `yarn.lock` files, and
`scripts/check-no-foreign-lockfiles.mjs` (run in CI) fails the build if one
appears — always install from the repo root with `pnpm install`.

## Prerequisites

| Tool | Required version | Why it is needed |
| --- | --- | --- |
| Node.js | `>=20` (root `engines`; every service package also pins `>=20`) | Runs TypeScript services, tests, docs, SDK, CLI, indexer, notifications, and the oracle service. |
| pnpm | `>=9` | The **only** supported package manager. Enable via `corepack enable`. |
| Docker Desktop or Docker Engine | Current stable | Runs the local Stellar node, Redis, deployer, seeder, indexer, and oracle service. |
| Docker Compose | Compose v2, available as `docker compose` | Starts the local stack from `docker-compose.yml`. |
| Rust | Stable toolchain | Builds and tests the Soroban smart contracts (in the `backend/` submodule). |
| Stellar CLI | Current stable | Builds, deploys, and invokes Soroban contracts locally and on testnet. |
| Git | Current stable | Clones this repo and initializes submodules. |

Check the basics:

```bash
node --version
corepack enable && pnpm --version
docker --version
docker compose version
rustc --version
cargo --version
stellar --version
```

`npm` is only used indirectly — some root scripts call `npm run <script> -w <pkg>`
as a thin wrapper. You never run `npm install` in this repo.

## Clone With Submodules

```bash
git clone --recurse-submodules https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network.git
cd Invoice-Liquidity-Network
```

If the repository was already cloned without submodules:

```bash
git submodule update --init --recursive
```

`.gitmodules` defines two submodules:

| Path | Upstream repo | Contains |
| --- | --- | --- |
| `frontend/` | [`ILN-Frontend`](https://github.com/Invoice-Liquidity-Network/ILN-Frontend) | The web application. |
| `backend/` | [`ILN-Smart-Contract`](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) | The Soroban contracts (`stellar contract build`, `cargo test`). |

### Why `frontend/` and `backend/` can look empty

They are intentional gitlinks to separate repositories, not empty workspace
packages. A normal clone creates the directory without downloading its contents.
Initialize one at a time with:

```bash
git submodule update --init frontend
git submodule update --init backend
```

Use `git submodule status <path>` to inspect the pinned revision. A leading `-`
means the submodule has not been initialized. Source changes belong in the
submodule repos; updates here should only advance the reviewed gitlink.

## Install Dependencies

One command, from the repo root:

```bash
pnpm install
```

This installs every workspace listed in `pnpm-workspace.yaml`:

- Top-level service packages: `sdk/`, `cli/`, `indexer/`, `notifications/`, `oracle-service/`, `docs/`
- `packages/*` — shared libraries and the deployed docs site
- `examples/*` — example applications

Do **not** run `npm ci`/`npm install`/`yarn` inside a subpackage — it creates a
foreign lockfile that CI rejects. Use `pnpm --filter <package> …` or the root
`turbo` scripts instead (see [Workspace Catalog](#workspace-catalog)).

Build everything once so cross-package type references resolve:

```bash
pnpm build          # turbo run build across all workspaces
pnpm type-check     # turbo run type-check
```

## Environment Variables

Copy only the examples for the services you run:

```bash
cp indexer/.env.example indexer/.env
cp notifications/.env.example notifications/.env
cp docs/.env.example docs/.env.local
```

`oracle-service/` has no `.env.example`; it reads all variables with defaults
(see the [Oracle Service Variables](#oracle-service-variables) table) and runs
with none set.

### Indexer Variables

| Variable | Description |
| --- | --- |
| `CONTRACT_ID` | Soroban contract ID whose events the indexer reads. Use `.docker-output/contract-id.txt` after local deployment. |
| `NETWORK_PASSPHRASE` | Stellar network passphrase. Local standalone uses `Standalone Network ; February 2017`; testnet uses `Test SDF Network ; September 2015`. |
| `RPC_URL` | Soroban RPC endpoint. Local Docker uses `http://stellar-node:8000/soroban/rpc` inside the compose network, or `http://localhost:8000/soroban/rpc` from the host. |
| `REDIS_URL` | Optional Redis connection string for distributed caching. The compose stack sets `redis://redis:6379`. |
| `DB_PATH` | SQLite database path for indexed data. |
| `POLL_INTERVAL_MS` | Polling interval for new ledgers and contract events. |
| `PORT` | REST API port, read as `CONFIG.apiPort`. Default `3001`. |
| `START_LEDGER` | First ledger to index. `0` lets the service choose a recent starting point. |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window length in milliseconds. |
| `RATE_LIMIT_MAX` | Maximum requests per IP per window. |
| `RATE_LIMIT_WHITELIST` | Comma-separated IPs exempt from public API rate limiting. |
| `BACKUP_ENABLED` | Enables automated indexer backups when set to `true`. |
| `BACKUP_INTERVAL_MS` | Backup cadence in milliseconds. |
| `BACKUP_DIR` | Local backup output directory. |
| `BACKUP_MAX_LOCAL` | Number of local backups to retain. |
| `BACKUP_CLOUD_PROVIDER` | Optional cloud backup provider: `s3`, `gcs`, or `azure`. |
| `BACKUP_CLOUD_BUCKET` | Cloud bucket name when cloud backups are enabled. |
| `BACKUP_CLOUD_PREFIX` | Optional folder or key prefix for cloud backups. |
| `BACKUP_CLOUD_REGION` | Region for the cloud backup bucket. |

### Notifications Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Yes | — | Resend API key for email delivery. Use a test key when only running non-delivery tests. |
| `NOTIFICATIONS_RPC_URL` | Yes | — | Stellar/Soroban RPC endpoint used to poll invoice events. |
| `NOTIFICATIONS_CONTRACT_ID` | Yes | — | Contract ID to monitor. Use `.docker-output/contract-id.txt` locally. |
| `NOTIFICATIONS_NETWORK_PASSPHRASE` | Yes | — | Stellar network passphrase for the monitored network. |
| `NOTIFICATIONS_DB_PATH` | No | `notifications.sqlite` | SQLite database path for notification state and preferences. |
| `RESEND_FROM_EMAIL` | No | `no-reply@invoice-liquidity.network` | Sender address used for email notifications. |
| `NOTIFICATIONS_POLL_INTERVAL_MS` | No | `30000` | Polling interval for event checks. |
| `NOTIFICATIONS_START_LEDGER` | No | `0` | First ledger to poll. `0` means start from the service default. |
| `DUE_WARNING_HOURS` | No | `48` | Number of hours before due date to send warnings. |
| `PORT` | No | `4001` | HTTP port for notification APIs. The WebSocket server runs on `PORT + 1` (`4002`). |
| `RATE_LIMIT_PER_USER` / `RATE_LIMIT_PER_CHANNEL` / `RATE_LIMIT_WINDOW_MS` | No | `60` / `200` / `60000` | API rate limits. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | No | — | SMS delivery via Twilio. |

### Oracle Service Variables

All optional — see [oracle-service.md](oracle-service.md) for behaviour.

| Variable | Default | Description |
| --- | --- | --- |
| `ORACLE_PORT` | `3010` | HTTP server port. |
| `INDEXER_BASE_URL` | `http://localhost:3001` | Indexer service base URL for payer history lookups. |
| `REDIS_URL` | (unset) | If set, uses Redis instead of the in-memory cache. |
| `ORACLE_REPUTATION_RPC_URL` | (unset) | Soroban RPC endpoint for on-chain reputation. |
| `ORACLE_REPUTATION_CONTRACT_ID` | (unset) | Contract ID for reputation reads. |
| `ORACLE_CACHE_TTL_SECONDS` | `300` | Cache TTL. |
| `ORACLE_REQUEST_TIMEOUT_MS` | `3500` | HTTP timeout to the indexer. |
| `ORACLE_MAX_ORACLE_AGE_MS` | `300000` | Max acceptable data age (5 min). |
| `ORACLE_RATE_LIMIT_WINDOW_MS` / `ORACLE_RATE_LIMIT_MAX_REQUESTS` | `60000` / `100` | Per-IP rate limit. |
| `ORACLE_ENABLE_RATE_LIMIT` | `true` | Toggle rate limiting. |
| `ORACLE_NETWORK_PASSPHRASE` | Testnet | Stellar network for the reputation contract. |

### Docs Variables

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_ALGOLIA_APP_ID` | Algolia DocSearch application ID. Optional for local docs browsing. |
| `NEXT_PUBLIC_ALGOLIA_API_KEY` | Public search API key for DocSearch. Optional locally. |
| `NEXT_PUBLIC_ALGOLIA_INDEX_NAME` | Algolia index name for the docs site. Optional locally. |

## Start the Docker Stack

Make sure ports `8000`, `11626`, `6379`, `3001`, and `3010` are free, then start
the full stack:

```bash
docker compose up --build
```

For detached mode:

```bash
docker compose up --build -d
```

`docker-compose.yml` defines six services:

| Service | Purpose | Port(s) | Health / readiness |
| --- | --- | --- | --- |
| `stellar-node` | Standalone Stellar Quickstart node with Soroban RPC. | `8000`, `11626` | `curl -s http://localhost:8000/friendbot` returns JSON with `"status": 400`. |
| `redis` | Cache backend shared by the indexer and oracle service. | `6379` | `docker compose ps redis` shows `running`. |
| `contract-deployer` | Builds/deploys the local contract, or writes a dummy ID when no compiled WASM exists. | — | `docker compose ps contract-deployer` shows `exited (0)`. |
| `account-seeder` | Creates funded test accounts, mock assets, and `.docker-output/*` files after the deployer completes. | — | `docker compose ps account-seeder` shows `exited (0)`. |
| `indexer` | Runs `pnpm dev -w iln-indexer` against the local node. | `3001` | `curl http://localhost:3001/health` (or `/v1/health`). |
| `oracle-service` | Runs `pnpm oracle:dev`; depends on `stellar-node`, `indexer`, and `redis`. | `3010` | `curl http://localhost:3010/v1/health`. |

> The `indexer` and `oracle-service` containers run `pnpm install --frozen-lockfile`
> on start against a bind-mount of the repo, so the first `up` is slow. For fast
> iteration on those two, run only the infra services in Docker
> (`docker compose up stellar-node redis contract-deployer account-seeder`) and
> run the Node services on the host (see [Run Services Individually](#run-services-individually)).

Verify the output:

```bash
docker compose ps
ls .docker-output
cat .docker-output/contract-id.txt
```

Expected files:

| File | Contents |
| --- | --- |
| `.docker-output/accounts.json` | Test account public keys, secret keys, mock asset IDs, and contract ID. |
| `.docker-output/contract-id.txt` | Local contract ID or dummy ID. |
| `.docker-output/usdc-id.txt` | Mock USDC asset ID. |
| `.docker-output/eurc-id.txt` | Mock EURC asset ID. |

Stop and reset the local ledger:

```bash
docker compose down -v
```

## Workspace Catalog

Every workspace, its package name, and the commands that build/run/test it.
Cross-check against [monorepo-map.md](monorepo-map.md).

### Top-level service packages

| Path | Package | Build | Run (dev) | Test |
| --- | --- | --- | --- | --- |
| `sdk/` | `@iln/sdk` | `pnpm --filter @iln/sdk build` | — (library) | `pnpm --filter @iln/sdk test` |
| `cli/` | `@invoice-liquidity/cli` | `pnpm --filter @invoice-liquidity/cli build` | `node cli/dist/bin.js --help` | `pnpm --filter @invoice-liquidity/cli test` |
| `indexer/` | `iln-indexer` | `pnpm --filter iln-indexer build` | `pnpm --filter iln-indexer dev` | `pnpm --filter iln-indexer test` |
| `notifications/` | `iln-notifications` | `pnpm --filter iln-notifications build` | `pnpm --filter iln-notifications dev` | `pnpm --filter iln-notifications test` |
| `oracle-service/` | `@iln/oracle-service` | `pnpm oracle:build` | `pnpm oracle:dev` | `pnpm oracle:test` |
| `docs/` | `@invoice-liquidity/docs` | `pnpm --filter @invoice-liquidity/docs build` | `pnpm docs:dev` | `pnpm --filter @invoice-liquidity/docs test` |

### Shared library packages (`packages/*`)

| Path | Package | Notable scripts |
| --- | --- | --- |
| `packages/shared/` | `@iln/shared` | `build`, `type-check`, `test` |
| `packages/eslint-config/` | `@iln/eslint-config` | (config only, no scripts) |
| `packages/test-utils/` | `@iln/test-utils` | `test`, `type-check` |
| `packages/indexer/` | `@iln/indexer` | `build`, `test`, `lint` |
| `packages/sdk/` | `@iln/sdk-next` | `build`, `build:browser`, `test`, `test:browser`, `test:mutation`, `docs:generate` |
| `packages/docs/` | `@invoice-liquidity/docs-next` | `dev`, `build`, `start`, `lint` — the **deployed** site ([docs.iln.finance](https://docs.iln.finance)) |
| `packages/mock-backend/` | `@iln/mock-backend` | `build`, `type-check`, `test`, `test:coverage` |
| `packages/react/` | `@iln/react` | `build`, `dev`, `test`, `type-check` (also `pnpm react:dev` / `react:build` / `react:test`) |
| `packages/opentelemetry/` | `@iln/opentelemetry` | `build`, `test` |
| `packages/upgrade-tests/` | `@iln/upgrade-tests` | `build`, `test` |
| `packages/scripts/` | (unpublished) | Internal dev/CI scripts |

Run any script for one package with `pnpm --filter <package> <script>`, or across
the whole repo with `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm type-check`
(each is `turbo run <task>`).

### Example applications (`examples/*`)

`analytics-plugin`, `governance-monitor`, `javascript-example`, `lp-automation`,
`portfolio-report`, `react-example`, `submit-invoice`, `typescript-example` —
each has its own `package.json`. Run one with:

```bash
pnpm --filter <example-package-name> start   # or: dev
```

They consume the workspace copies of `@iln/sdk` / `@iln/react`, so run
`pnpm build` first.

## Run Services Individually

### SDK (`@iln/sdk`)

```bash
pnpm --filter @iln/sdk build
pnpm --filter @iln/sdk test
pnpm --filter @iln/sdk test:e2e-local   # requires the Docker stack running
```

### CLI (`@invoice-liquidity/cli`)

```bash
pnpm --filter @invoice-liquidity/cli build
pnpm --filter @invoice-liquidity/cli test
pnpm --filter @invoice-liquidity/cli type-check
```

After building, run the local binary:

```bash
node cli/dist/bin.js --help
```

### Indexer (`iln-indexer`)

```bash
cp indexer/.env.example indexer/.env
pnpm --filter iln-indexer dev
```

In another terminal:

```bash
curl http://localhost:3001/v1/health
```

The bare `curl http://localhost:3001/health` also works but returns
`Deprecation` headers — `/v1` is the canonical prefix.

### Notifications (`iln-notifications`)

```bash
cp notifications/.env.example notifications/.env
pnpm --filter iln-notifications dev
```

In another terminal:

```bash
curl http://localhost:4001/health
```

If delivery credentials are not configured, keep to local tests and non-delivery
API checks. The WebSocket server listens on `4002` (`/ws`).

### Oracle Service (`@iln/oracle-service`)

```bash
pnpm oracle:dev            # or: pnpm --filter @iln/oracle-service dev
```

In another terminal:

```bash
curl http://localhost:3010/v1/health
```

It needs the indexer reachable at `INDEXER_BASE_URL` (default
`http://localhost:3001`) for history lookups, but degrades gracefully to
reputation-only assessment when the indexer is down.

### Docs

```bash
pnpm docs:dev                                   # legacy Nextra 2 source (docs/)
pnpm --filter @invoice-liquidity/docs-next dev  # deployed Nextra 3 site (packages/docs/)
```

Regenerate the auto-generated reference pages after changing SDK or CLI sources:

```bash
pnpm docs:api    # @iln/sdk TypeDoc → docs/sdk-api/ (local scratch output)
pnpm docs:cli    # cli/scripts/generate-docs.ts → packages/docs/content/cli-reference.mdx

# Deployed-site SDK reference (committed) — regenerated in CI by sdk-api-docs.yml:
pnpm --filter @iln/sdk-next docs:generate   # → packages/docs/content/sdk-reference/generated/
```

## Run Tests

| Area | Command |
| --- | --- |
| Entire workspace | `pnpm test` (`turbo run test`) |
| Workspace coverage | `pnpm test:coverage` |
| Root E2E (`tests/e2e/*`) | `pnpm test:e2e` (needs the Docker stack) |
| SDK | `pnpm --filter @iln/sdk test` |
| SDK coverage | `pnpm --filter @iln/sdk test:coverage` |
| SDK local-node e2e | `pnpm --filter @iln/sdk test:e2e-local` |
| CLI | `pnpm --filter @invoice-liquidity/cli test` |
| CLI type check | `pnpm --filter @invoice-liquidity/cli type-check` |
| Indexer | `pnpm --filter iln-indexer test` |
| Indexer coverage | `pnpm --filter iln-indexer test:coverage` |
| Notifications | `pnpm --filter iln-notifications test` |
| Notifications coverage | `pnpm --filter iln-notifications test:coverage` |
| Oracle service | `pnpm oracle:test` |
| Oracle service coverage | `pnpm --filter @iln/oracle-service test:coverage` (enforces the 95% gate) |
| `@iln/sdk-next` | `pnpm --filter @iln/sdk-next test` |
| `@iln/react` | `pnpm react:test` |
| `@iln/shared` / `@iln/mock-backend` / `@iln/indexer` / `@iln/upgrade-tests` | `pnpm --filter <package> test` |
| Contracts (submodule) | `cd backend && cargo test` |
| Load test indexer | `pnpm test:load:indexer` |
| Load test notifications | `pnpm test:load:notifications` |
| License scan | `pnpm licence:check` |
| Secret scan | `pnpm gitleaks:scan` |
| Foreign-lockfile check | `pnpm validate:lockfiles` |

## Common Errors and Fixes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `docker compose` is not found | Docker Compose v2 is not installed or Docker Desktop is not running. | Install Docker Desktop or the Compose v2 plugin, then rerun `docker compose version`. |
| Port `8000`, `11626`, `6379`, `3001`, or `3010` already allocated | Another Stellar Quickstart, Redis, indexer, oracle, or previous compose stack is running. | Run `docker compose down -v`, stop the conflicting process, or change port mappings locally. |
| `stellar-node` health check never passes | Docker VM is still starting, network access is blocked, or the image changed endpoints. | Check `docker compose logs stellar-node`; retry after Docker is fully ready. |
| `dummy-contract-id-for-local-dev` appears | No compiled WASM was found by the deployer. | Build the contract in `backend/` (`stellar contract build`), then rerun `docker compose up --build contract-deployer account-seeder`. |
| `pnpm install` fails with an engine warning | Node.js is older than the `>=20` requirement. | Install Node.js 20+ with `nvm`, Volta, `fnm`, or your OS package manager. |
| `pnpm: command not found` | Corepack is not enabled. | Run `corepack enable`, or `npm i -g pnpm@9`. |
| CI fails on `validate:lockfiles` | A `package-lock.json` or `yarn.lock` was created in a subpackage. | Delete it; run `pnpm install` from the repo root only. |
| `ERR_PNPM_...` about a missing workspace package | Cross-package build outputs are stale. | Run `pnpm build` (or `pnpm --filter <pkg>... build`) before running the dependent package. |
| `oracle-service` returns `rejected-stale-data` locally | The indexer has no history for the payer, or its data is older than `ORACLE_MAX_ORACLE_AGE_MS`. | Seed invoices for the payer and let the indexer catch up, or raise `maxOracleAgeMs` on the request. |
| Rust cannot build a WASM target | The Soroban target is missing. | `scripts/dev-setup.sh` installs `wasm32-unknown-unknown`; the contract build may instead need `wasm32v1-none` — add whichever the `backend/` workspace or CI requests with `rustup target add <target>`. |
| Stellar CLI command is not found | Stellar CLI is not installed or not on `PATH`. | Install it from the Stellar developer tools instructions and restart the shell. |
| macOS Docker file sharing errors | The repository path is not shared with Docker Desktop. | Add the parent directory in Docker Desktop → Settings → Resources → File sharing. |
| macOS: `docker compose up` extremely slow for `indexer`/`oracle-service` | Bind-mount + `pnpm install` over the osxfs/VirtioFS boundary. | Enable VirtioFS in Docker Desktop, or run those two services on the host instead of in Docker. |
| Ubuntu permission denied on Docker socket | The user is not in the `docker` group. | Use `sudo docker …` temporarily or add the user to the `docker` group and restart the session. |
| Ubuntu: `EACCES` on SQLite files under `.docker-output/` | Files were written by the container's root user. | `sudo chown -R "$USER" .docker-output indexer.db notifications.sqlite`. |
| Windows WSL cannot reach localhost service | Docker Desktop WSL integration or port forwarding is disabled. | Enable integration for the distro and run commands from the same WSL distribution that owns the checkout. |
| Windows checkout shows script line-ending errors | Git converted shell scripts to CRLF. | Run `git config core.autocrlf input`, then re-checkout the affected scripts. |
| Windows: `pnpm` scripts fail on `sh -lc` compose commands | Compose commands use POSIX `sh`. | Run `docker compose` from WSL, not PowerShell/CMD. |

## Fresh-Machine Verification Checklist

Verify every step from a clean checkout of the current `dev` branch, on at least
two operating systems, before marking local setup docs as verified.

| Step | macOS | Ubuntu | Windows WSL |
| --- | --- | --- | --- |
| Install prerequisites and confirm versions | Pending | Pending | Pending |
| Clone with submodules (`frontend`, `backend`) | Pending | Pending | Pending |
| `pnpm install` then `pnpm build` | Pending | Pending | Pending |
| Start Docker stack (all six services healthy) | Pending | Pending | Pending |
| Verify `.docker-output/*` | Pending | Pending | Pending |
| Run SDK, CLI, indexer, notifications, oracle-service tests | Pending | Pending | Pending |
| Run `packages/*` tests (`pnpm test`) | Pending | Pending | Pending |
| Run at least one `examples/*` app | Pending | Pending | Pending |
| Start indexer, notifications, and oracle-service individually | Pending | Pending | Pending |
| `pnpm validate:lockfiles` passes (no foreign lockfiles created) | Pending | Pending | Pending |
| Record OS-specific troubleshooting notes | Pending | Pending | Pending |

---

## Scripts Reference

The `scripts/` directory contains helper scripts invoked by `make` targets or CI.
They run on the host. The Docker services in `docker-compose.yml` are
`stellar-node`, `redis`, `contract-deployer`, `account-seeder`, `indexer`, and
`oracle-service`.

| Script | Invoked by | Target network | Purpose |
|--------|-----------|----------------|---------|
| `scripts/dev-setup.sh` | `make setup` | local | Installs the Rust toolchain, the `wasm32-unknown-unknown` target, and the Stellar CLI. |
| `scripts/deploy.ts` | Manual / CI | testnet / mainnet | Deploys the Soroban contract and updates `.env` and `README.md` with the new Contract ID. Supports `--network=mainnet` and `--dry-run`. |
| `scripts/seed.sh` | `make seed` | local | Seeds the local node with test identities (`freelancer`, `payer`, `funder`), mock USDC, and sample invoices. Requires `.local-contract-id`. |
| `scripts/fund-wallets.sh` | Manual | testnet | Funds wallet addresses via Friendbot and mints mock USDC. Testnet only — not the local node. |
| `scripts/check-no-foreign-lockfiles.mjs` | `pnpm validate:lockfiles`, CI | — | Fails if any `package-lock.json` / `yarn.lock` exists. |
| `scripts/load-test-indexer.ts` / `scripts/load-test-notifications.ts` | `pnpm test:load:indexer` / `:notifications` | local | Load-test harnesses for the indexer and notification services. |

### Relationship between Docker services and Make targets

`docker compose up --build` (used by CI and `pnpm test:e2e`) starts the full
stack — including `indexer` and `oracle-service` — through Docker in dependency
order via health checks.

`make deploy-local` and `make seed` perform the equivalent **contract**
deployment and seeding steps directly on the host using the `scripts/` scripts,
against the `backend/` contract workspace. Use the Make targets for contract
iteration; use Docker Compose for CI and full-stack E2E runs.

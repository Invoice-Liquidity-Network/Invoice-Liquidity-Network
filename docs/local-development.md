# Local Development

This guide sets up the local ILN stack: Stellar Quickstart, contract deployment helpers, account seeding, SDK, CLI, indexer, and notifications.

## Prerequisites

| Tool | Required version | Why it is needed |
| --- | --- | --- |
| Node.js | `>=20` for the root workspace; `>=18` for older package folders | Runs TypeScript services, tests, docs, SDK, CLI, indexer, and notifications. |
| pnpm | `>=9` | Primary monorepo package manager for root scripts and workspace packages. |
| npm | Bundled with Node.js | Some legacy package folders still use `package-lock.json` and `npm` scripts directly. |
| Docker Desktop or Docker Engine | Current stable | Runs the local Stellar node, deployer, and account seeder. |
| Docker Compose | Compose v2, available as `docker compose` | Starts the local stack from `docker-compose.yml`. |
| Rust | Stable toolchain | Builds and tests Soroban smart contracts. |
| Stellar CLI | Current stable | Builds, deploys, and invokes Soroban contracts locally and on testnet. |
| Git | Current stable | Clones this repo and initializes submodules. |

Check the basics:

```bash
node --version
pnpm --version
docker --version
docker compose version
rustc --version
cargo --version
stellar --version
```

## Clone With Submodules

```bash
git clone --recurse-submodules https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network.git
cd Invoice-Liquidity-Network
```

If the repository was already cloned without submodules:

```bash
git submodule update --init --recursive
```

### Why `frontend/` can look empty

`frontend/` is an intentional gitlink to the separate
[`ILN-Frontend`](https://github.com/Invoice-Liquidity-Network/ILN-Frontend)
repository, not an empty workspace package. The root `.gitmodules` file defines
that relationship, while the `frontend` workspace entry lets pnpm include the
application after the submodule has been initialized. A normal clone creates the
directory without downloading its contents.

Initialize only the frontend checkout with:

```bash
git submodule update --init frontend
```

Use `git submodule status frontend` to inspect the pinned revision. A leading `-`
means the submodule has not been initialized. Frontend source changes belong in
`ILN-Frontend`; updates here should only advance the reviewed `frontend` gitlink.

## Install Dependencies

Install the root workspace first:

```bash
pnpm install
```

Some top-level services also keep their own lockfiles. Install them when you plan to run those services directly:

```bash
npm ci --prefix sdk
npm ci --prefix cli
npm ci --prefix indexer
npm ci --prefix notifications
```

## Environment Variables

Copy only the examples for the services you run:

```bash
cp indexer/.env.example indexer/.env
cp notifications/.env.example notifications/.env
cp docs/.env.example docs/.env.local
```

### Indexer Variables

| Variable | Description |
| --- | --- |
| `CONTRACT_ID` | Soroban contract ID whose events the indexer reads. Use `.docker-output/contract-id.txt` after local deployment. |
| `NETWORK_PASSPHRASE` | Stellar network passphrase. Local standalone defaults to `Standalone Network ; February 2017`; testnet uses `Test SDF Network ; September 2015`. |
| `RPC_URL` | Soroban RPC endpoint. Local Docker uses `http://localhost:8000/soroban/rpc` or the endpoint exposed by the Quickstart image in your version. |
| `DB_PATH` | SQLite database path for indexed data. |
| `POLL_INTERVAL_MS` | Polling interval for new ledgers and contract events. |
| `PORT` | REST API port, usually `3001`. |
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

| Variable | Description |
| --- | --- |
| `NOTIFICATIONS_DB_PATH` | SQLite database path for notification state and preferences. |
| `NOTIFICATIONS_RPC_URL` | Stellar or Soroban RPC endpoint used to poll invoice events. |
| `NOTIFICATIONS_CONTRACT_ID` | Contract ID to monitor. Use `.docker-output/contract-id.txt` locally. |
| `NOTIFICATIONS_NETWORK_PASSPHRASE` | Stellar network passphrase for the monitored network. |
| `RESEND_API_KEY` | Resend API key for email delivery. Use a test key or leave unset when only running non-delivery tests. |
| `RESEND_FROM_EMAIL` | Sender address used for email notifications. |
| `NOTIFICATIONS_POLL_INTERVAL_MS` | Polling interval for event checks. |
| `NOTIFICATIONS_START_LEDGER` | First ledger to poll. `0` means start from the service default. |
| `DUE_WARNING_HOURS` | Number of hours before due date to send warnings. |
| `PORT` | HTTP port for notification APIs, usually `4001`. |

### Docs Variables

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_ALGOLIA_APP_ID` | Algolia DocSearch application ID. Optional for local docs browsing. |
| `NEXT_PUBLIC_ALGOLIA_API_KEY` | Public search API key for DocSearch. Optional locally. |
| `NEXT_PUBLIC_ALGOLIA_INDEX_NAME` | Algolia index name for the docs site. Optional locally. |

## Start the Docker Stack

Make sure ports `8000` and `11626` are free, then start the full stack:

```bash
docker compose up --build
```

For detached mode:

```bash
docker compose up --build -d
```

The stack starts:

| Service | Purpose | Health check |
| --- | --- | --- |
| `stellar-node` | Local Stellar Quickstart node with Soroban RPC enabled. | `curl -s http://localhost:8000/friendbot` returns a JSON response. |
| `contract-deployer` | Deploys the local contract or writes a dummy ID when no compiled WASM exists. | `docker compose ps contract-deployer` shows `exited (0)`. |
| `account-seeder` | Creates funded test accounts, mock assets, and `.docker-output/*` files. | `docker compose ps account-seeder` shows `exited (0)`. |

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

## Run Services Individually

### SDK

```bash
npm run build --prefix sdk
npm run test --prefix sdk
npm run test:e2e-local --prefix sdk
```

### CLI

```bash
npm run build --prefix cli
npm run test --prefix cli
npm run check --prefix cli
```

After building, run the local binary:

```bash
node cli/dist/bin.js --help
```

### Indexer

```bash
cp indexer/.env.example indexer/.env
npm run dev --prefix indexer
```

In another terminal:

```bash
curl http://localhost:3001/health
```

If the service does not expose `/health` in your branch, confirm it started by checking the console logs and the SQLite file configured by `DB_PATH`.

### Notifications

```bash
cp notifications/.env.example notifications/.env
npm run dev --prefix notifications
```

In another terminal:

```bash
curl http://localhost:4001/health
```

If delivery credentials are not configured, keep to local tests and non-delivery API checks.

### Docs

```bash
pnpm docs:dev
```

## Run Tests

| Area | Command |
| --- | --- |
| Entire pnpm workspace | `pnpm test` |
| Root coverage task | `pnpm test:coverage` |
| SDK | `npm run test --prefix sdk` |
| SDK coverage | `npm run test:coverage --prefix sdk` |
| SDK local node e2e | `npm run test:e2e-local --prefix sdk` |
| CLI | `npm run test --prefix cli` |
| CLI type check | `npm run check --prefix cli` |
| Indexer | `npm run test --prefix indexer` |
| Indexer coverage | `npm run test:coverage --prefix indexer` |
| Notifications | `npm run test --prefix notifications` |
| Notifications coverage | `npm run test:coverage --prefix notifications` |
| Load test indexer | `pnpm test:load:indexer` |
| Load test notifications | `pnpm test:load:notifications` |
| License scan | `pnpm licence:check` |
| Secret scan | `pnpm gitleaks:scan` |

## Common Errors and Fixes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `docker compose` is not found | Docker Compose v2 is not installed or Docker Desktop is not running. | Install Docker Desktop or the Compose v2 plugin, then rerun `docker compose version`. |
| Port `8000` or `11626` is already allocated | Another Stellar Quickstart, local API, or previous compose stack is running. | Run `docker compose down -v`, stop the conflicting process, or change port mappings locally. |
| `stellar-node` health check never passes | Docker VM is still starting, network access is blocked, or the image changed endpoints. | Check `docker compose logs stellar-node`; retry after Docker is fully ready. |
| `dummy-contract-id-for-local-dev` appears | No compiled WASM was found by the deployer. | Build the contract in the smart contract workspace, then rerun `docker compose up --build contract-deployer account-seeder`. |
| `pnpm install` fails with an engine warning | Node.js is older than the root `>=20` requirement. | Install Node.js 20 or newer with `nvm`, Volta, fnm, or your OS package manager. |
| `npm ci --prefix <service>` fails after dependency changes | Lockfile is out of date for that service. | Run the package maintainer-approved install command and commit lockfile changes in the same PR. |
| Rust cannot build a WASM target | The Soroban target is missing. | Install the target requested by the contract workspace or CI, commonly `rustup target add wasm32v1-none`. |
| Stellar CLI command is not found | Stellar CLI is not installed or not on `PATH`. | Install it from the Stellar developer tools instructions and restart the shell. |
| macOS Docker file sharing errors | The repository path is not shared with Docker Desktop. | Add the parent directory in Docker Desktop settings under file sharing. |
| Ubuntu permission denied on Docker socket | The user is not in the `docker` group. | Use `sudo docker ...` temporarily or add the user to the `docker` group and restart the session. |
| Windows WSL cannot reach localhost service | Docker Desktop WSL integration or port forwarding is disabled. | Enable integration for the distro and run commands from the same WSL distribution that owns the checkout. |
| Windows checkout shows script line ending errors | Git converted shell scripts to CRLF. | Run `git config core.autocrlf input`, then re-checkout the affected scripts. |

## Fresh-Machine Verification Checklist

Use this checklist before marking local setup docs as verified on a new OS image:

| Step | macOS | Ubuntu | Windows WSL |
| --- | --- | --- | --- |
| Install prerequisites and confirm versions | Pending | Pending | Pending |
| Clone with submodules | Pending | Pending | Pending |
| Install dependencies | Pending | Pending | Pending |
| Start Docker stack | Pending | Pending | Pending |
| Verify `.docker-output/*` | Pending | Pending | Pending |
| Run SDK, CLI, indexer, and notifications tests | Pending | Pending | Pending |
| Start indexer and notifications individually | Pending | Pending | Pending |
| Record OS-specific troubleshooting notes | Pending | Pending | Pending |

---

## Scripts Reference

The `scripts/` directory contains helper scripts invoked directly by `make` targets or CI. They are **not** containerised — `docker-compose.yml` provides only the Stellar node, contract deployer, and account seeder as Docker services. The scripts run on the host.

| Script | Invoked by | Target network | Purpose |
|--------|-----------|----------------|---------|
| `scripts/dev-setup.sh` | `make setup` | local | Installs Rust, `wasm32-unknown-unknown` target, and Stellar CLI |
| `scripts/deploy.ts` | Manual / CI | testnet / mainnet | Deploys the Soroban contract and updates `.env` and `README.md` with the new Contract ID. Supports `--network=mainnet` and `--dry-run` flags. |
| `scripts/seed.sh` | `make seed` | local | Seeds the local node with test identities (`freelancer`, `payer`, `funder`), mock USDC, and sample invoices. Requires `.local-contract-id` to exist. |
| `scripts/fund-wallets.sh` | Manual | testnet | Funds wallet addresses via Friendbot and mints mock USDC. Designed for testnet only — not the local node. |

### Relationship between Docker services and Make targets

`docker compose up --build` (used by CI and `npm run test:e2e`) starts all three services — `stellar-node`, `contract-deployer`, and `account-seeder` — through Docker.

`make deploy-local` and `make seed` perform the equivalent steps directly on the host using the `scripts/` scripts. Use the Make targets for day-to-day local development; use Docker Compose for CI and full-stack E2E runs.

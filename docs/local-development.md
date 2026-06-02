# Local Development Environment

This guide explains how to quickly set up a complete local Stellar development environment using a single Docker Compose command.

## Prerequisites

- **Docker** and **Docker Compose**: Required to run the local Stellar node and initialization services.
- Ensure ports `8000` and `11626` are available.
- *(Optional)* A compiled `.wasm` contract file located at `backend/target/wasm32-unknown-unknown/release/invoice_liquidity.wasm` or similar. If not found, a dummy contract ID will be generated for testing.

## Start the Environment

To start the complete environment (Stellar node, contract deployment, and account seeding), run:

```bash
docker compose up
```

For detached mode, use:

```bash
docker compose up -d
```

The stack will:
1. Start a local Stellar Quickstart node.
2. Wait for the node to become healthy.
3. Deploy the smart contract (via the `contract-deployer` service).
4. Create and fund test accounts and mock assets (via the `account-seeder` service).

## Output Directory Contents

Once the `account-seeder` service completes, it writes essential information to the git-ignored `.docker-output/` directory:

- `.docker-output/accounts.json`: Contains the public and secret keys for the `freelancer`, `payer`, and `funder` test accounts, along with the deployed `usdc` and `eurc` asset IDs, and the `contractId`.
- `.docker-output/contract-id.txt`: The raw deployed contract ID.
- `.docker-output/usdc-id.txt` / `.docker-output/eurc-id.txt`: The raw IDs of the mock tokens.

These files are formatted for easy consumption by the frontend and CLI tools.

## Tearing Down

To stop the environment and completely clear the local chain state and volumes, run:

```bash
docker compose down -v
```

> **Note:** The `-v` flag ensures that the local persistent chain data (`stellar-data` volume) is removed, giving you a completely fresh slate on your next start.

## Common Troubleshooting

- **Containers failing to start:** Ensure Docker is running and ports `8000` and `11626` are not occupied by other services.
- **Contract deployed with dummy ID:** If you see `dummy-contract-id-for-local-dev` in `.docker-output/contract-id.txt`, it means the compiled `.wasm` file wasn't found. Ensure you've built the contract locally first using `make build` or standard Rust cargo commands inside the contract workspace.
- **Node healthcheck failing:** In rare cases, the quickstart node takes longer to initialize. The seeder and deployer will patiently wait or retry via Docker Compose dependency checks.
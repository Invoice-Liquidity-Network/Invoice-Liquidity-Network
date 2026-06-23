# Local Development Environment
This guide explains how to quickly set up a local Soroban testing environment for the Invoice Liquidity Network project. The Hardhat-style test environment allows you to develop, build, and test locally in under 5 minutes.
## Prerequisites
Before starting, ensure you have the following installed on your system:
- **Docker**: Used to run the isolated local Stellar node (`stellar-local`).
## Setup in Under 5 Minutes
We provide a streamlined `Makefile` at the repository root to automate the entire setup process. 
Run the commands below sequentially:
### 1. Install Dependencies
```bash
make setup
```
This script detects your OS natively (works on Ubuntu 22+ and macOS 13+) and installs:
- Cargo / Rust (if missing)
- the WebAssembly target (`wasm32-unknown-unknown`)
- `stellar-cli` (Stellar's development interface)
### 2. Build the Contract
```bash
make build
```
Compiles the `InvoiceLiquidityContract` Rust source code into a scalable `.wasm` format targeting `wasm32-unknown-unknown`. It ensures all workspace crates are correctly synchronized.
### 3. Deploy to Local Network
```bash
make deploy-local
```
This command spins up the official `stellar/quickstart` Docker image to act as your Standalone local Stellar node. It generates an admin account, funds it with Friendbot, and seamlessly maps the local test network to your stellar configuration. Then, it deploys the built `.wasm` contract to this node. The resulting Contract ID is cached in `.local-contract-id`.
### 4. Seed Test Data
```bash
make seed
```
Creates generic end-to-end testing identities inside test wallets: **freelancer**, **payer**, and **funder**. It wraps the native network asset (XLM) to act as a **Mock USDC Token** locally. It automatically invokes the contract initialization sequence and submits 3 distinct sample invoices simulating real-world states for testing frontend applications cleanly.
### 5. Run Contracts Tests
```bash
make test
```
Executes the comprehensive inline integration and unit test suite explicitly.
---
## Tearing Down
To clean up your local network effectively, halt the running Docker container, and delete the temporary config files, execute:
```bash
make clean
```
This spins down `stellar-local` efficiently leaving your local registry completely decoupled.
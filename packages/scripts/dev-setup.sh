#!/usr/bin/env bash
set -e
echo "Setting up local development environment..."
# 1. Check/Install Rust
if ! command -v rustc &> /dev/null; then
    echo "Rust not found. Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    echo "Rust is already installed."
fi
# 2. Add proper WASM target
echo "Adding wasm32-unknown-unknown target..."
rustup target add wasm32-unknown-unknown || rustup target add wasm32-unknown-unknown --toolchain stable
# Wait for a moment to ensure cargo is accessible
export PATH="$HOME/.cargo/bin:$PATH"
# 3. Check/Install Stellar CLI
if ! command -v stellar &> /dev/null; then
    echo "Stellar CLI not found. Installing via cargo..."
    cargo install --locked stellar-cli --features opt
else
    echo "Stellar CLI is already installed."
fi
echo "Setup complete! You can now run 'make build'"
.PHONY: setup build deploy-local seed test clean
setup:
	@chmod +x scripts/dev-setup.sh
	@./scripts/dev-setup.sh
build:
	@cd invoice-liquidity-network && stellar contract build
deploy-local:
	@echo "Starting local Stellar node (soroban-quickstart)..."
	@docker run --rm -d -p 8000:8000 --name stellar-local stellar/quickstart:testing --local --enable-soroban-rpc
	@echo "Waiting for node and Friendbot to initialize..."
	@while ! curl -s http://localhost:8000/friendbot | grep -q '"status": 400'; do sleep 3; done
	@stellar network add local --rpc-url http://localhost:8000/rpc --network-passphrase "Standalone Network ; February 2017" || true
	@echo "Generating admin key for deployment..."
	@stellar keys generate admin --network local || true
	@echo "Funding admin account..."
	@stellar keys fund admin --network local || true
	@echo "Deploying contract to local network..."
	@cd invoice-liquidity-network && stellar contract deploy \
		--wasm target/wasm32v1-none/release/invoice_liquidity.wasm \
		--source admin \
		--network local \
		> ../.local-contract-id
	@echo "Contract deployed locally: $$(cat .local-contract-id)"
seed:
	@chmod +x scripts/seed.sh
	@./scripts/seed.sh
test:
	@cd invoice-liquidity-network && cargo test
clean:
	@echo "Stopping local Stellar node..."
	@docker rm -f stellar-local >/dev/null 2>&1 || true
	@rm -f .local-contract-id .local-usdc-id

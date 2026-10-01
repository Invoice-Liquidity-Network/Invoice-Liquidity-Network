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
	# scripts/seed.sh seeds the local Stellar node with test identities and sample invoices.
	# scripts/fund-wallets.sh is a separate testnet utility (not run here); invoke it manually:
	#   ./scripts/fund-wallets.sh <ADDRESS1> <ADDRESS2> ...
	@chmod +x scripts/seed.sh
	@./scripts/seed.sh

test:
	@cd invoice-liquidity-network && cargo test

clean:
	@echo "Stopping local Stellar node..."
	@docker rm -f stellar-local >/dev/null 2>&1 || true
	@rm -f .local-contract-id .local-usdc-id

#!/usr/bin/env bash
set -e

echo "Starting contract deployment..."
mkdir -p .docker-output

# Add local network
stellar network add local --rpc-url http://stellar-node:8000/rpc --network-passphrase "Standalone Network ; February 2017" || true

echo "Generating admin key..."
stellar keys generate admin --network local || true

echo "Funding admin key..."
stellar keys fund admin --network local || true

# Look for the compiled WASM in standard locations
WASM_FILE=""
if [ -f "invoice-liquidity-network/target/wasm32v1-none/release/invoice_liquidity.wasm" ]; then
    WASM_FILE="invoice-liquidity-network/target/wasm32v1-none/release/invoice_liquidity.wasm"
elif [ -f "backend/target/wasm32-unknown-unknown/release/invoice_liquidity.wasm" ]; then
    WASM_FILE="backend/target/wasm32-unknown-unknown/release/invoice_liquidity.wasm"
elif [ -f "target/wasm32v1-none/release/invoice_liquidity.wasm" ]; then
    WASM_FILE="target/wasm32v1-none/release/invoice_liquidity.wasm"
fi

if [ -n "$WASM_FILE" ]; then
    echo "Deploying contract from $WASM_FILE..."
    stellar contract deploy \
        --wasm "$WASM_FILE" \
        --source admin \
        --network local > .docker-output/contract-id.txt
    echo "Contract deployed: $(cat .docker-output/contract-id.txt)"
else
    echo "WARNING: Built WASM file not found. Writing a dummy Contract ID."
    echo "dummy-contract-id-for-local-dev" > .docker-output/contract-id.txt
fi

echo "Deployment finished."

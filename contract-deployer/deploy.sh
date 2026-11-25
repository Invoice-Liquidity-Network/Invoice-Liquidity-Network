#!/usr/bin/env bash
set -e

# Environment overrides allow an operator to target an explicitly configured
# network. LOCAL remains the Docker Compose default.
NETWORK=${NETWORK:-local}
# Soroban RPC lives under /soroban/rpc on the stellar/quickstart image — the
# same path every other service in this repo uses (docker-compose.yml's
# indexer, docs/local-development.md, scripts/provision-e2e-contract.mjs).
RPC_URL=${RPC_URL:-http://stellar-node:8000/soroban/rpc}
NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}
SOURCE=${SOURCE:-admin}
DRY_RUN=${DRY_RUN:-false}
EXISTING_CONTRACT_ID=${EXISTING_CONTRACT_ID:-}
# How long to wait for Soroban RPC to report healthy before deploying. The
# Compose healthcheck only confirms Horizon/Friendbot on :8000 (see
# docker-compose.yml) — Soroban RPC on the same quickstart container can
# still be catching up, so `contract-deployer` cannot assume it is ready just
# because `stellar-node` is "healthy".
RPC_HEALTH_RETRIES=${RPC_HEALTH_RETRIES:-20}
RPC_HEALTH_DELAY_SECONDS=${RPC_HEALTH_DELAY_SECONDS:-3}

case "$DRY_RUN" in true|false) ;; *) echo 'DRY_RUN must be true or false.' >&2; exit 2 ;; esac

# A deployed Soroban contract ID: `C` followed by 55 base32 (RFC 4648,
# uppercase + digits 2-7) characters. Matches
# scripts/provision-e2e-contract.mjs's isDeployedContractIdShape.
is_contract_id() {
    [[ "$1" =~ ^C[A-Z2-7]{55}$ ]]
}

if [ -n "$EXISTING_CONTRACT_ID" ] && ! is_contract_id "$EXISTING_CONTRACT_ID"; then
    echo "ERROR: EXISTING_CONTRACT_ID=\"$EXISTING_CONTRACT_ID\" is not a well-formed contract ID" >&2
    echo "  (expected: C followed by 55 base32 characters)." >&2
    echo "  recovery: double-check the recorded ID, or unset EXISTING_CONTRACT_ID to deploy fresh." >&2
    exit 1
fi

# Poll Soroban RPC's getHealth until it reports healthy, or give up after
# RPC_HEALTH_RETRIES attempts. A dead/unreachable/not-yet-ready RPC must fail
# the deploy closed instead of letting `stellar contract deploy` fail later
# with a less actionable error (or, worse, letting a stale EXISTING_CONTRACT_ID
# be reported as successfully deployed against an RPC it was never checked
# against).
wait_for_rpc_health() {
    local attempt=1
    while [ "$attempt" -le "$RPC_HEALTH_RETRIES" ]; do
        if curl -fsS -X POST "$RPC_URL" \
            -H 'Content-Type: application/json' \
            -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null \
            | grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"'; then
            return 0
        fi
        echo "Waiting for Soroban RPC at $RPC_URL to report healthy (attempt $attempt/$RPC_HEALTH_RETRIES)..." >&2
        attempt=$((attempt + 1))
        sleep "$RPC_HEALTH_DELAY_SECONDS"
    done
    return 1
}

echo "Starting contract deployment..."
if [ "$DRY_RUN" = false ]; then
    mkdir -p .docker-output

    if ! wait_for_rpc_health; then
        echo "ERROR: Soroban RPC at $RPC_URL did not report healthy after $RPC_HEALTH_RETRIES attempt(s)." >&2
        echo "  recovery: confirm the node is up (docker compose ps stellar-node) and that RPC_URL" >&2
        echo "            points at its /soroban/rpc path. No contract ID was written." >&2
        exit 1
    fi
fi

# The local Docker network is registered here. Remote aliases must be configured
# by the operator in Stellar CLI so this script cannot silently retarget them.
if [ "$DRY_RUN" = false ] && [ "$NETWORK" = local ]; then
    stellar network add "$NETWORK" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" 2>/dev/null || true
fi

# Compose's standalone network needs a local funded identity. Remote networks
# must use a source identity configured by the operator and are never funded by
# this helper.
if [ "$DRY_RUN" = false ] && [ "$NETWORK" = local ]; then
    stellar keys generate "$SOURCE" --network "$NETWORK" 2>/dev/null || true
    stellar keys fund "$SOURCE" --network "$NETWORK" || true
fi

if [ "$DRY_RUN" = true ]; then
    echo "DRY RUN: network=$NETWORK source=$SOURCE existing_contract=${EXISTING_CONTRACT_ID:-none}"
fi

# Look for the compiled WASM in standard locations
WASM_FILE=""
if [ -f "invoice-liquidity-network/target/wasm32v1-none/release/invoice_liquidity.wasm" ]; then
    WASM_FILE="invoice-liquidity-network/target/wasm32v1-none/release/invoice_liquidity.wasm"
elif [ -f "backend/target/wasm32v1-none/release/invoice_liquidity.wasm" ]; then
    WASM_FILE="backend/target/wasm32v1-none/release/invoice_liquidity.wasm"
elif [ -f "backend/target/wasm32-unknown-unknown/release/invoice_liquidity.wasm" ]; then
    WASM_FILE="backend/target/wasm32-unknown-unknown/release/invoice_liquidity.wasm"
elif [ -f "target/wasm32v1-none/release/invoice_liquidity.wasm" ]; then
    WASM_FILE="target/wasm32v1-none/release/invoice_liquidity.wasm"
fi

if [ -n "$WASM_FILE" ]; then
    if [ -n "$EXISTING_CONTRACT_ID" ]; then
        echo "Reusing configured contract ID: $EXISTING_CONTRACT_ID"
        if [ "$DRY_RUN" = false ]; then
            printf '%s\n' "$EXISTING_CONTRACT_ID" > .docker-output/contract-id.txt
        fi
    elif [ "$DRY_RUN" = true ]; then
        echo "DRY RUN: would deploy WASM $WASM_FILE using source $SOURCE on $NETWORK."
    else
        echo "Deploying contract from $WASM_FILE to $NETWORK..."
        deploy_output="$(stellar contract deploy --wasm "$WASM_FILE" --source "$SOURCE" --network "$NETWORK")"
        deployed_id="${deploy_output##*$'\n'}"
        if ! is_contract_id "$deployed_id"; then
            echo "ERROR: deployment did not return a well-formed contract ID (got: ${deployed_id:-<empty>})." >&2
            echo "  recovery: inspect the Stellar CLI output above. No contract ID was written." >&2
            exit 1
        fi
        printf '%s\n' "$deployed_id" > .docker-output/contract-id.txt
        echo "Contract deployed: $deployed_id"
    fi
else
    if [ -n "$EXISTING_CONTRACT_ID" ]; then
        echo "Reusing configured contract ID: $EXISTING_CONTRACT_ID"
        if [ "$DRY_RUN" = false ]; then printf '%s\n' "$EXISTING_CONTRACT_ID" > .docker-output/contract-id.txt; fi
    elif [ "$DRY_RUN" = true ]; then
        echo "DRY RUN: no built WASM found; no placeholder ID will be written."
    else
        # Fail closed (#1242): a placeholder contract ID must never be published to
        # downstream consumers (CI, seeder, frontend), because any test asserting
        # against it proves nothing. Previously this wrote
        # "dummy-contract-id-for-local-dev" and let dependent suites believe they
        # were talking to a deployed contract.
        echo "ERROR: no built WASM found, so no real contract can be deployed." >&2
        echo "  recovery: build the contract (cargo build --target wasm32v1-none --release)," >&2
        echo "            or re-run with EXISTING_CONTRACT_ID=<deployed contract id>." >&2
        echo "            See docs/runbooks/e2e-prerequisites.md." >&2
        exit 1
    fi
fi

echo "Deployment finished."

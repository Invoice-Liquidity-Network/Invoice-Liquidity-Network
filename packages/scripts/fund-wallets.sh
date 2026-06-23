#!/usr/bin/env bash

# scripts/fund-wallets.sh
# Automates testnet XLM funding via Friendbot and mock USDC minting.

set -e

# Configuration
USDC_MINT_AMOUNT=10000000000 # 1000 USDC (assuming 7 decimals)
MAX_RETRIES=5
INITIAL_BACKOFF=1

# Dependencies
check_dependencies() {
    for cmd in stellar curl grep sed; do
        if ! command -v $cmd &> /dev/null; then
            echo "Error: $cmd is required but not installed."
            exit 1
        fi
    done
}

# Exponential Backoff Retry Function
retry() {
    local n=1
    local max=$MAX_RETRIES
    local delay=$INITIAL_BACKOFF
    while true; do
        "$@" && break || {
            if [[ $n -lt $max ]]; then
                ((n++))
                echo "Command failed. Attempt $n/$max: Retrying in ${delay}s..."
                sleep $delay
                delay=$((delay * 2))
            else
                echo "Command failed after $n attempts."
                return 1
            fi
        }
    done
}

# Fetch XLM Balance from Horizon
get_xlm_balance() {
    local addr=$1
    local balance
    balance=$(curl -s "https://horizon-testnet.stellar.org/accounts/$addr" | \
              grep -B 5 '"asset_type": "native"' | \
              grep '"balance":' | \
              sed 's/.*"balance": "\(.*\)".*/\1/' | head -n 1 || echo "0.0")
    echo "$balance"
}

# Fetch USDC Balance via Soroban Contract
get_usdc_balance() {
    local addr=$1
    local usdc_id=$2
    if [ -z "$usdc_id" ]; then echo "N/A"; return; fi
    
    local balance
    balance=$(stellar contract invoke \
             --id "$usdc_id" \
             --network testnet \
             -- \
             balance \
             --id "$addr" 2>/dev/null | grep -oE '[0-9]+' || echo "0")
    echo "$balance"
}

# Main Execution
check_dependencies

WALLETS=("$@")
if [ ${#WALLETS[@]} -eq 0 ] && [ -f "dev-wallets.txt" ]; then
    mapfile -t WALLETS < dev-wallets.txt
fi

if [ ${#WALLETS[@]} -eq 0 ]; then
    echo "Error: No wallet addresses provided."
    echo "Usage: ./scripts/fund-wallets.sh <ADDRESS1> <ADDRESS2> ..."
    echo "Or populate dev-wallets.txt with addresses (one per line)."
    exit 1
fi

echo "🚀 Starting testnet funding flow for ${#WALLETS[@]} wallets..."
echo "Network: testnet"
echo "USDC Contract ID: ${USDC_CONTRACT_ID:-Not Set}"

declare -A XLM_FINAL
declare -A USDC_FINAL

for ADDR in "${WALLETS[@]}"; do
    if [[ -z "$ADDR" || "$ADDR" =~ ^# ]]; then continue; fi
    
    echo ""
    echo "Processing: $ADDR"
    
    # 1. XLM Funding
    echo "  - Funding XLM via Friendbot..."
    if retry curl -s "https://friendbot.stellar.org/?addr=$ADDR" > /dev/null; then
        echo "  - ✅ XLM funded."
    else
        echo "  - ❌ XLM funding failed."
    fi
    
    # 2. USDC Minting
    if [ -n "$USDC_CONTRACT_ID" ] && [ -n "$ADMIN_SECRET" ]; then
        echo "  - Minting mock USDC..."
        if retry stellar contract invoke \
            --id "$USDC_CONTRACT_ID" \
            --source "$ADMIN_SECRET" \
            --network testnet \
            -- \
            mint \
            --to "$ADDR" \
            --amount "$USDC_MINT_AMOUNT" > /dev/null; then
            echo "  - ✅ USDC minted ($USDC_MINT_AMOUNT units)."
        else
            echo "  - ❌ USDC minting failed."
        fi
    else
        echo "  - ⚠️ USDC skipped (USDC_CONTRACT_ID or ADMIN_SECRET missing)."
    fi
    
    # 3. Collect Balances
    XLM_FINAL["$ADDR"]=$(get_xlm_balance "$ADDR")
    USDC_FINAL["$ADDR"]=$(get_usdc_balance "$ADDR" "$USDC_CONTRACT_ID")
done

# Output Summary Table
echo ""
echo "=========================================================================================="
printf "| %-56s | %-12s | %-15s |\n" "Wallet Address" "XLM Balance" "USDC Balance"
echo "------------------------------------------------------------------------------------------"
for ADDR in "${WALLETS[@]}"; do
    if [[ -z "$ADDR" || "$ADDR" =~ ^# ]]; then continue; fi
    printf "| %-56s | %-12s | %-15s |\n" "$ADDR" "${XLM_FINAL[$ADDR]}" "${USDC_FINAL[$ADDR]}"
done
echo "=========================================================================================="
echo "✅ Funding process complete."

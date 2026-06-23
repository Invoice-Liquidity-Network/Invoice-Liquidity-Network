#!/usr/bin/env bash
set -e

echo "Seeding local environment..."

NETWORK="local"
RPC_URL="http://localhost:8000/rpc"

if ! docker ps | grep -q stellar-local; then
    echo "Error: stellar-local container is not running. Did you run 'make deploy-local'?"
    exit 1
fi

if [ ! -f ".local-contract-id" ]; then
    echo "Error: .local-contract-id not found. Deploy contract first."
    exit 1
fi
CONTRACT_ID=$(cat .local-contract-id)

echo "Generating generic testing identities..."
stellar keys generate freelancer --network $NETWORK || true
stellar keys generate payer --network $NETWORK || true
stellar keys generate funder --network $NETWORK || true

FREELANCER=$(stellar keys address freelancer)
PAYER=$(stellar keys address payer)
FUNDER=$(stellar keys address funder)

echo "Funding test identities..."
stellar keys fund freelancer --network $NETWORK || true
stellar keys fund payer --network $NETWORK || true
stellar keys fund funder --network $NETWORK || true

echo "Accounts funded!"

echo "Deploying mock USDC..."
stellar contract asset deploy --asset native --source admin --network $NETWORK > .local-usdc-id
USDC_ID=$(cat .local-usdc-id)
echo "Mock USDC Address: $USDC_ID"

echo "Initializing InvoiceLiquidityContract with mock USDC..."
# initialize(env: Env, token: Address)
stellar contract invoke \
    --id $CONTRACT_ID \
    --source admin \
    --network $NETWORK \
    -- \
    initialize \
    --token $USDC_ID || echo "Contract already initialized."

echo "Submitting 3 sample invoices on behalf of freelancer..."

# submit_invoice(freelancer, payer, amount, due_date, discount_rate)
FUTURE_DATE=$(($(date +%s) + 86400 * 30)) # 30 days from now

echo "Submitting invoice 1..."
stellar contract invoke \
    --id $CONTRACT_ID \
    --source freelancer \
    --network $NETWORK \
    -- \
    submit_invoice \
    --freelancer $FREELANCER \
    --payer $PAYER \
    --amount 10000000 \
    --due_date $FUTURE_DATE \
    --discount_rate 500

echo "Submitting invoice 2..."
stellar contract invoke \
    --id $CONTRACT_ID \
    --source freelancer \
    --network $NETWORK \
    -- \
    submit_invoice \
    --freelancer $FREELANCER \
    --payer $PAYER \
    --amount 25000000 \
    --due_date $FUTURE_DATE \
    --discount_rate 750

echo "Submitting invoice 3..."
stellar contract invoke \
    --id $CONTRACT_ID \
    --source freelancer \
    --network $NETWORK \
    -- \
    submit_invoice \
    --freelancer $FREELANCER \
    --payer $PAYER \
    --amount 5000000 \
    --due_date $FUTURE_DATE \
    --discount_rate 200

echo ""
echo "✅ Environments seeded successfully!"
echo "   Freelancer: $FREELANCER"
echo "   Payer: $PAYER"
echo "   Funder: $FUNDER"
echo "   USDC Token: $USDC_ID"
echo "   Contract ID: $CONTRACT_ID"

#!/usr/bin/env bash
set -e

echo "Starting account seeder..."
mkdir -p .docker-output

# The stellar CLI needs the network definition
stellar network add local --rpc-url http://stellar-node:8000/rpc --network-passphrase "Standalone Network ; February 2017" || true

echo "Generating and funding test accounts..."
stellar keys generate freelancer --network local || true
stellar keys fund freelancer --network local || true
FREELANCER_PUB=$(stellar keys address freelancer)
FREELANCER_SEC=$(stellar keys show freelancer)

stellar keys generate payer --network local || true
stellar keys fund payer --network local || true
PAYER_PUB=$(stellar keys address payer)
PAYER_SEC=$(stellar keys show payer)

stellar keys generate funder --network local || true
stellar keys fund funder --network local || true
FUNDER_PUB=$(stellar keys address funder)
FUNDER_SEC=$(stellar keys show funder)

echo "Deploying Mock USDC..."
stellar contract asset deploy --asset native --source admin --network local > .docker-output/usdc-id.txt || echo "native" > .docker-output/usdc-id.txt
USDC_ID=$(cat .docker-output/usdc-id.txt)

echo "Deploying Mock EURC..."
stellar contract asset deploy --asset native --source admin --network local > .docker-output/eurc-id.txt || echo "native" > .docker-output/eurc-id.txt
EURC_ID=$(cat .docker-output/eurc-id.txt)

CONTRACT_ID="not-found"
if [ -f ".docker-output/contract-id.txt" ]; then
    CONTRACT_ID=$(cat .docker-output/contract-id.txt)
fi

echo "Writing accounts output..."
cat <<EOF > .docker-output/accounts.json
{
  "freelancer": {
    "publicKey": "$FREELANCER_PUB",
    "secretKey": "$FREELANCER_SEC"
  },
  "payer": {
    "publicKey": "$PAYER_PUB",
    "secretKey": "$PAYER_SEC"
  },
  "funder": {
    "publicKey": "$FUNDER_PUB",
    "secretKey": "$FUNDER_SEC"
  },
  "tokens": {
    "usdc": "$USDC_ID",
    "eurc": "$EURC_ID"
  },
  "contractId": "$CONTRACT_ID"
}
EOF

# Initialize contract if we have a real one
if [ "$CONTRACT_ID" != "dummy-contract-id-for-local-dev" ] && [ "$CONTRACT_ID" != "not-found" ]; then
    echo "Initializing contract..."
    stellar contract invoke \
        --id $CONTRACT_ID \
        --source admin \
        --network local \
        -- \
        initialize \
        --token $USDC_ID || echo "Contract already initialized."
fi

echo "Seeding completed successfully!"

#!/bin/sh
# Fake `stellar` CLI for scripts/deploy.test.ts. Behavior is driven entirely by
# environment variables so each test can script a specific scenario without
# touching a real Stellar network or a real contract build.
#
#   DEPLOY_FAIL=1            contract deploy exits non-zero
#   VERIFY_MODE=mismatch     contract fetch writes bytes that don't match WASM_SRC
#   VERIFY_MODE=fail         contract fetch exits non-zero
#   HEALTH_MODE=rpc_fail     contract invoke exits non-zero with a non-contract error
#   HEALTH_MODE=contract_error  contract invoke exits non-zero with a contract-level error
#   WASM_SRC=<path>          file copied into --out-file on a matching fetch
#   DEPLOYED_CONTRACT_ID     id printed by a successful deploy

set -eu

subcommand="$2"

case "$subcommand" in
  build)
    exit 0
    ;;
  deploy)
    if [ "${DEPLOY_FAIL:-}" = "1" ]; then
      echo "simulated deploy failure" >&2
      exit 1
    fi
    echo "${DEPLOYED_CONTRACT_ID:-CONTRACT_FAKE_ID_123}"
    exit 0
    ;;
  fetch)
    out_file=""
    prev=""
    for arg in "$@"; do
      if [ "$prev" = "--out-file" ]; then
        out_file="$arg"
      fi
      prev="$arg"
    done
    if [ "${VERIFY_MODE:-}" = "fail" ]; then
      echo "simulated fetch failure" >&2
      exit 1
    fi
    if [ "${VERIFY_MODE:-}" = "mismatch" ]; then
      printf 'different-bytes' > "$out_file"
      exit 0
    fi
    cp "$WASM_SRC" "$out_file"
    exit 0
    ;;
  invoke)
    if [ "${HEALTH_MODE:-}" = "rpc_fail" ]; then
      echo "RPC connection refused" >&2
      exit 1
    fi
    if [ "${HEALTH_MODE:-}" = "contract_error" ]; then
      echo "HostError: Error(Contract, #1)" >&2
      exit 1
    fi
    echo '{"invoice_id":1}'
    exit 0
    ;;
  *)
    echo "fake-stellar: unknown subcommand $subcommand" >&2
    exit 1
    ;;
esac

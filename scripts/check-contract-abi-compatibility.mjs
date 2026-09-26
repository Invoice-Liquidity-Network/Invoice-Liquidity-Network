#!/usr/bin/env node

/**
 * check-contract-abi-compatibility.mjs
 *
 * Closes issue #1094 / #806 (docs/contract-abi-compatibility.md): verifies
 * that `packages/sdk/src/clients/InvoiceClient.ts` still agrees with the
 * deployed contract ABI before an SDK release ships.
 *
 * Data source: `backend/target/spec.json`, produced by
 *   stellar contract build
 *   stellar contract info --wasm target/wasm32v1-none/release/*.wasm --output-format json
 * against the `backend/` submodule (pinned to a commit of ILN-Smart-Contract).
 * Bumping that submodule pin is how an ABI change surfaces here — see
 * docs/cross-repo-sync.md and docs/contract-abi-compatibility.md.
 *
 * This does NOT parse InvoiceClient.ts with a TS AST — that would be fragile
 * against helper methods like `buildSubmitInvoiceArgs()` that assemble the
 * argument list conditionally. Instead it checks a small, hand-maintained
 * manifest (CONTRACT_CALL_MANIFEST below) against the spec's declared
 * function signatures. Contributors update the manifest in the same PR that
 * changes which/how many arguments InvoiceClient sends for a method — the
 * same discipline the repo already applies to
 * scripts/check-no-duplicate-types.mjs and scripts/check-monorepo-map-drift.mjs.
 *
 * Usage:  node scripts/check-contract-abi-compatibility.mjs [--spec <path>]
 * Exit 0 = compatible, exit 1 = drift found, exit 2 = spec.json unavailable
 * (soft-fails with a warning in CI when the backend submodule isn't built —
 * see the `sdk-types-sync` job in .github/workflows/ci.yml, which already
 * tolerates a missing spec.json).
 */

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

/**
 * Every contract method `InvoiceClient.ts` calls, and how many ScVal
 * arguments it sends: `required` are always sent; `optional` is the maximum
 * number of additional args sent when optional input fields are present.
 * Keep this in sync with InvoiceClient.ts's `buildWriteTransaction` /
 * `buildReadTransaction` call sites.
 */
export const CONTRACT_CALL_MANIFEST = [
  { method: 'submit_invoice', required: 6, optional: 2, caller: 'InvoiceClient.submitInvoice' },
  { method: 'fund_invoice', required: 3, optional: 1, caller: 'InvoiceClient.fundInvoice' },
  { method: 'mark_paid', required: 3, optional: 0, caller: 'InvoiceClient.markPaid' },
  { method: 'dispute_invoice', required: 4, optional: 0, caller: 'InvoiceClient.disputeInvoice' },
  {
    method: 'submit_dispute_evidence',
    required: 3,
    optional: 0,
    caller: 'InvoiceClient.submitDisputeEvidence',
  },
  { method: 'resolve_dispute', required: 4, optional: 0, caller: 'InvoiceClient.resolveDispute' },
  {
    method: 'auto_resolve_dispute',
    required: 2,
    optional: 0,
    caller: 'InvoiceClient.autoResolveDispute',
  },
  { method: 'get_invoice', required: 1, optional: 0, caller: 'InvoiceClient.getInvoiceAmounts' },
  {
    method: 'get_contract_stats',
    required: 0,
    optional: 0,
    caller: 'sdk/src/integration/testnet.test.ts',
  },
  { method: 'get_reputation', required: 1, optional: 0, caller: 'sdk/src/integration/testnet.test.ts' },
];

/**
 * Parses a Soroban `stellar contract info --output-format json` document
 * into a Map of function name -> input count. Non-function entries
 * (UdtStructV0, UdtEnumV0, ...) are ignored.
 */
export function parseFunctionInputCounts(specJson) {
  const spec = JSON.parse(specJson);
  const functions = new Map();
  for (const entry of spec) {
    if (entry.type === 'FunctionV0' && entry.name) {
      functions.set(entry.name, Array.isArray(entry.inputs) ? entry.inputs.length : 0);
    }
  }
  return functions;
}

/**
 * Compares the manifest against the parsed spec. Returns an array of
 * findings; each has a `code` of MISSING_IN_SPEC or ARITY_MISMATCH.
 */
export function checkCompatibility(functionInputCounts, manifest = CONTRACT_CALL_MANIFEST) {
  const findings = [];

  for (const call of manifest) {
    if (!functionInputCounts.has(call.method)) {
      findings.push({
        code: 'MISSING_IN_SPEC',
        method: call.method,
        caller: call.caller,
        message: `${call.caller} calls contract method "${call.method}", which no longer exists in the deployed ABI.`,
      });
      continue;
    }

    const specInputs = functionInputCounts.get(call.method);
    const min = call.required;
    const max = call.required + call.optional;

    if (specInputs < min || specInputs > max) {
      findings.push({
        code: 'ARITY_MISMATCH',
        method: call.method,
        caller: call.caller,
        specInputs,
        expectedRange: [min, max],
        message:
          `${call.caller} sends ${min}-${max} argument(s) to "${call.method}", but the deployed ` +
          `ABI now declares ${specInputs} input(s). Update InvoiceClient.ts and this manifest together.`,
      });
    }
  }

  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const specFlagIdx = args.indexOf('--spec');
  const specPath = resolve(
    REPO_ROOT,
    specFlagIdx !== -1 ? args[specFlagIdx + 1] : join('backend', 'target', 'spec.json')
  );

  let specJson;
  try {
    specJson = readFileSync(specPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(
        `⚠️  ${specPath} not found — the backend submodule isn't built in this environment.\n` +
          '   This check is skipped locally, but runs in CI on every change to the `backend`\n' +
          '   submodule pin or to packages/sdk/src/clients/** (see .github/workflows/ci.yml,\n' +
          '   job "sdk-types-sync"), where the contract is always built fresh first.'
      );
      process.exit(2);
    }
    throw err;
  }

  const functionInputCounts = parseFunctionInputCounts(specJson);
  const findings = checkCompatibility(functionInputCounts);

  if (findings.length === 0) {
    console.log(
      `✅ InvoiceClient.ts agrees with the deployed ABI (${CONTRACT_CALL_MANIFEST.length} call site(s) checked against ${functionInputCounts.size} contract function(s)).`
    );
    process.exit(0);
  }

  console.error(`\n❌ Found ${findings.length} SDK/deployed-ABI incompatibilit(y/ies):\n`);
  for (const f of findings) {
    console.error(`  [${f.code}] ${f.message}`);
  }
  console.error(
    '\nThis means the SDK could silently break for every consumer once released. See\n' +
      'docs/contract-abi-compatibility.md for the guarantee this check provides and how to fix drift.'
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

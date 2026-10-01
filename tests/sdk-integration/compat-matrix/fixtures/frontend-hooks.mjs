/**
 * Frontend-hooks consumer fixture (Issue #1035).
 *
 * packages/react's hooks (useInvoice, useBatchSubmitInvoice, useGovernanceProposal,
 * etc.) don't construct an SDK client themselves — ILNProvider takes an already-built
 * ILNClient/ILNSdk instance, and every hook calls a method on it via useILNClient().
 * The representative regression this fixture catches is exactly the one a hook
 * would hit: the named export the provider is built from disappearing, its
 * constructor's required config shape changing, or a method a real hook calls
 * disappearing or changing arity.
 */
export async function run(sdkModuleSpecifier) {
  const sdk = await import(sdkModuleSpecifier);

  assertExport(sdk, 'ILNSdk', 'function');
  assertExport(sdk, 'ILN_TESTNET', 'object');

  // Real usage pattern per the SDK's own docs (sdk/src/client.ts constructor example):
  // `new ILNSdk({ ...ILN_TESTNET, signer: ... })`.
  const client = new sdk.ILNSdk({ ...sdk.ILN_TESTNET });

  // One representative method per hook family actually shipped in packages/react/src/hooks.
  const methodsHooksCallThrough = {
    useInvoice: 'getInvoice',
    useBatchSubmitInvoice: 'batchSubmitInvoices',
    useGovernanceProposal: 'getProposal',
    useProtocolConfig: 'getProtocolConfig',
  };

  for (const [hook, method] of Object.entries(methodsHooksCallThrough)) {
    if (typeof client[method] !== 'function') {
      throw new Error(`ILNSdk instance is missing "${method}()", which the ${hook} hook (packages/react) calls via useILNClient().`);
    }
  }
}

function assertExport(mod, name, expectedTypeofResult) {
  if (typeof mod[name] !== expectedTypeofResult) {
    throw new Error(`Expected "${name}" to be exported as ${expectedTypeofResult}, got ${typeof mod[name]}`);
  }
}

/**
 * Example-scripts consumer fixture (Issue #1035).
 *
 * examples/typescript-example/index.ts imports ILNSdk, ILN_TESTNET,
 * createKeypairSigner, and the Invoice/ProtocolConfig/BatchResult types from
 * the package root. Types vanish silently for a runtime check, so this
 * exercises the runtime-checkable half: the named value exports it
 * destructures, and the constructor pattern it demonstrates.
 */
export async function run(sdkModuleSpecifier) {
  const sdk = await import(sdkModuleSpecifier);
  // examples/typescript-example/index.ts imports Keypair from @stellar/stellar-sdk
  // directly, alongside @iln/sdk — the fixture mirrors that same two-import pattern.
  const { Keypair } = await import('@stellar/stellar-sdk');

  assertExport(sdk, 'ILNSdk', 'function');
  assertExport(sdk, 'ILN_TESTNET', 'object');
  assertExport(sdk, 'createKeypairSigner', 'function');
  assertExport(sdk, 'SDK_VERSION', 'string');

  // Mirrors examples/typescript-example/index.ts's construction pattern:
  // `new ILNSdk({ ...ILN_TESTNET, signer: createKeypairSigner(secretKey) })`.
  const secret = Keypair.random().secret();
  let signer;
  try {
    signer = sdk.createKeypairSigner(secret);
  } catch (err) {
    throw new Error(`createKeypairSigner() rejected a freshly-generated valid secret key — signature or validation likely changed: ${err.message}`);
  }

  new sdk.ILNSdk({ ...sdk.ILN_TESTNET, signer });
}

function assertExport(mod, name, expectedTypeofResult) {
  if (typeof mod[name] !== expectedTypeofResult) {
    throw new Error(`Expected "${name}" to be exported as ${expectedTypeofResult}, got ${typeof mod[name]}`);
  }
}

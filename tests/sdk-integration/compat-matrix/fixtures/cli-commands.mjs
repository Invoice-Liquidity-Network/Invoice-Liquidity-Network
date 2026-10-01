/**
 * CLI-commands consumer fixture (Issue #1035).
 *
 * cli/src/cli.ts imports `checkCompatibility` (a free function, distinct from
 * `ILNSdk#checkCompatibility`) directly from the package root, plus the
 * `ILNSdk` class itself for `generate.ts`'s codegen template. Both must keep
 * resolving with their current shapes for the CLI to keep working unmodified
 * against a new SDK minor.
 */
export async function run(sdkModuleSpecifier) {
  const sdk = await import(sdkModuleSpecifier);

  assertExport(sdk, 'checkCompatibility', 'function');
  assertExport(sdk, 'ILNSdk', 'function');
  assertExport(sdk, 'createKeypairSigner', 'function');

  // cli/src/cli.ts calls checkCompatibility(invokeFn) — a standalone contract/SDK
  // version-compatibility probe, not a network call itself, so it's safe to invoke
  // with a stub that reports "compatible" without needing a live RPC endpoint.
  const stubInvoke = async () => ({ compatible: true });
  const result = await sdk.checkCompatibility(stubInvoke);
  if (typeof result !== 'object' || result === null) {
    throw new Error('checkCompatibility() no longer returns an object — cli/src/cli.ts destructures its result.');
  }
}

function assertExport(mod, name, expectedTypeofResult) {
  if (typeof mod[name] !== expectedTypeofResult) {
    throw new Error(`Expected "${name}" to be exported as ${expectedTypeofResult}, got ${typeof mod[name]}`);
  }
}

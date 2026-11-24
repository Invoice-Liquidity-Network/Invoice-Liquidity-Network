/**
 * Legacy Import Compatibility Shim
 *
 * This module provides backwards-compatible export aliases for code
 * that was written against older SDK versions or transition-period APIs.
 *
 * Issue #1219: Add compatibility shim for legacy SDK imports
 * Issue #1222: Importing this entry point emits a one-time migration warning
 *              (see ./deprecation.ts and docs/sdk-migration-guide.md).
 */

import { warnDeprecated } from './deprecation';

// Side effect on purpose: `sideEffects` in package.json lists this entry's
// bundles so bundlers keep the warning. tests: src/legacy-imports.test.ts.
warnDeprecated('legacy-import');

// Re-export all public APIs under their canonical names
export * from './index';

// Legacy class aliases for deprecated method names that may still be in use
export { ILNSdk } from './client';

// Re-export shared types that may have been imported directly in legacy code
export type { Invoice, NetworkConfig, TransactionSigner } from './types';
export type { ValidationResult } from './amounts';
export type { ILNError } from './errors';

// Legacy configuration exports
export { ILN_TESTNET } from './signers';

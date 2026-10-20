/**
 * Legacy Import Compatibility Shim
 *
 * This module provides backwards-compatible export aliases for code
 * that was written against older SDK versions or transition-period APIs.
 *
 * Issue #1219: Add compatibility shim for legacy SDK imports
 * Issue #1222: Add migration warnings for deprecated SDK surface
 */

import { ILNClient } from './client';
import type { ILNClientConfig } from './types';
export * from './index';

let hasWarnedILNSdk = false;
let hasWarnedIlnTestnet = false;

/**
 * Emits a structured deprecation notice to console.warn once per feature.
 */
export function emitSdkDeprecationWarning(feature: string, replacement: string): void {
  console.warn(
    `[DEPRECATION] `${feature}` is deprecated and scheduled for removal in v1.0.0. Please migrate to `${replacement}`. See docs/sdk-migration-guide.md.`
  );
}

/**
 * @deprecated Use `ILNClient` from '@iln/sdk' instead.
 */
export class ILNSdk extends ILNClient {
  constructor(config: ILNClientConfig) {
    if (!hasWarnedILNSdk) {
      emitSdkDeprecationWarning('ILNSdk', 'ILNClient');
      hasWarnedILNSdk = true;
    }
    super(config);
  }
}

// Re-export shared types that may have been imported directly in legacy code
export type { Invoice, NetworkConfig, TransactionSigner } from './types';
export type { ValidationResult } from './amounts';
export type { ILNError } from './errors';

import { ILN_TESTNET as RAW_ILN_TESTNET } from './signers';

/**
 * @deprecated Use `NETWORKS.TESTNET` from '@iln/sdk' instead.
 */
export const ILN_TESTNET = new Proxy(RAW_ILN_TESTNET, {
  get(target, prop, receiver) {
    if (!hasWarnedIlnTestnet) {
      emitSdkDeprecationWarning('ILN_TESTNET', 'NETWORKS.TESTNET');
      hasWarnedIlnTestnet = true;
    }
    return Reflect.get(target, prop, receiver);
  },
});

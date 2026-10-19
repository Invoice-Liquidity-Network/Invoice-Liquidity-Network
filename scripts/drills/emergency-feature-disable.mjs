#!/usr/bin/env node

/**
 * Emergency Feature-Disable & Circuit Breaker Harness (#1327)
 *
 * Implements and verifies emergency kill-switch controls across protocol components:
 * - Contract emergency pause (fund_invoice, submit_invoice, payout)
 * - Settlement payout kill switch
 * - Oracle verification bypass
 * - Notification dispatch kill switch
 *
 * Enforces admin authorization, idempotent toggling, and fail-closed execution guards.
 */

export class EmergencyFeatureDisabledError extends Error {
  constructor(feature, reason) {
    super(`[EMERGENCY_FEATURE_DISABLED] Feature '${feature}' is currently disabled: ${reason}`);
    this.name = 'EmergencyFeatureDisabledError';
    this.feature = feature;
    this.code = 'FEATURE_DISABLED';
  }
}

export class UnauthorizedAdminRequiredError extends Error {
  constructor(caller) {
    super(`[UNAUTHORIZED] Caller '${caller}' is not an authorized emergency administrator`);
    this.name = 'UnauthorizedAdminRequiredError';
    this.code = 'UNAUTHORIZED_ADMIN';
  }
}

export const CANONICAL_FEATURES = [
  'CONTRACT_CORE_OPERATIONS',
  'SETTLEMENT_PAYOUTS',
  'INDEXER_INGESTION',
  'ORACLE_PRICE_FEED',
  'NOTIFICATIONS_DISPATCH',
];

export class EmergencyFeatureManager {
  constructor(authorizedAdmins = ['@admin-multisig', '@sec-commander']) {
    this.authorizedAdmins = new Set(authorizedAdmins);
    this.featureStates = new Map();
    for (const f of CANONICAL_FEATURES) {
      this.featureStates.set(f, {
        enabled: true,
        disabledAt: null,
        disabledBy: null,
        reason: null,
      });
    }
    this.auditLog = [];
  }

  isFeatureEnabled(feature) {
    const state = this.featureStates.get(feature);
    if (!state) throw new Error(`Unknown feature: ${feature}`);
    return state.enabled;
  }

  assertFeatureEnabled(feature) {
    const state = this.featureStates.get(feature);
    if (!state) throw new Error(`Unknown feature: ${feature}`);
    if (!state.enabled) {
      throw new EmergencyFeatureDisabledError(feature, state.reason ?? 'Emergency administrative kill switch active');
    }
  }

  disableFeature(feature, caller, reason = 'Emergency mitigation') {
    if (!this.authorizedAdmins.has(caller)) {
      throw new UnauthorizedAdminRequiredError(caller);
    }
    const state = this.featureStates.get(feature);
    if (!state) throw new Error(`Unknown feature: ${feature}`);

    // Idempotent: already disabled
    if (!state.enabled) {
      return { status: 'ALREADY_DISABLED', feature, reason: state.reason };
    }

    state.enabled = false;
    state.disabledAt = new Date().toISOString();
    state.disabledBy = caller;
    state.reason = reason;

    this.auditLog.push({
      timestamp: state.disabledAt,
      action: 'EMERGENCY_DISABLE',
      feature,
      caller,
      reason,
    });

    return { status: 'DISABLED', feature, disabledAt: state.disabledAt };
  }

  enableFeature(feature, caller) {
    if (!this.authorizedAdmins.has(caller)) {
      throw new UnauthorizedAdminRequiredError(caller);
    }
    const state = this.featureStates.get(feature);
    if (!state) throw new Error(`Unknown feature: ${feature}`);

    if (state.enabled) {
      return { status: 'ALREADY_ENABLED', feature };
    }

    state.enabled = true;
    state.disabledAt = null;
    state.disabledBy = null;
    state.reason = null;

    this.auditLog.push({
      timestamp: new Date().toISOString(),
      action: 'EMERGENCY_RESTORE',
      feature,
      caller,
    });

    return { status: 'RESTORED', feature };
  }
}

#!/usr/bin/env node

/**
 * Release Rollback Criteria Engine for SDK and Services (#1323)
 *
 * Implements objective, verifiable criteria governing whether to roll back
 * a newly shipped SDK release (npm) or microservice deployment (indexer,
 * oracle-service, notifications).
 */

export const DEFAULT_ROLLBACK_POLICIES = {
  sdk: {
    maxErrorRatePercent: 1.0,
    allowBreakingXdrChange: false,
    requireDeprecationNotice: true,
  },
  indexer: {
    maxCursorLagLedgers: 10,
    maxCrashCount15m: 3,
    maxDbErrorRatePercent: 0.5,
  },
  notifications: {
    maxDeliveryFailureRatePercent: 2.0,
    maxQueueStallSeconds: 120,
    maxCrashCount15m: 3,
  },
  oracle: {
    maxP99LatencySeconds: 2.5,
    maxStaleResponseRatePercent: 1.0,
    maxCrashCount15m: 3,
  },
};

export class ReleaseRollbackEvaluator {
  constructor(customPolicies = {}) {
    this.policies = { ...DEFAULT_ROLLBACK_POLICIES, ...customPolicies };
  }

  evaluateSdkRelease(metrics) {
    const policy = this.policies.sdk;
    const triggers = [];

    if (metrics.breakingXdrChange && !policy.allowBreakingXdrChange) {
      triggers.push({
        severity: 'CRITICAL',
        code: 'SDK_BREAKING_XDR_MUTATION',
        message: 'Unannounced breaking XDR or signature serialization mutation detected in SDK release',
      });
    }

    if (metrics.clientErrorRatePercent > policy.maxErrorRatePercent) {
      triggers.push({
        severity: 'HIGH',
        code: 'SDK_HIGH_CLIENT_ERROR_RATE',
        message: `Client error rate ${metrics.clientErrorRatePercent}% exceeds max threshold ${policy.maxErrorRatePercent}%`,
      });
    }

    const shouldRollback = triggers.length > 0;
    return {
      component: 'sdk',
      shouldRollback,
      triggers,
      recommendedAction: shouldRollback ? 'NPM_DEPRECATE_AND_DOWNGRADE_PIN' : 'PROCEED_RELEASE',
      recoverySteps: shouldRollback ? [
        'Issue npm deprecation notice on released version',
        'Update package.json in dependent packages (react, cli) to previous stable tag',
        'Publish emergency patch or security advisory',
      ] : [],
    };
  }

  evaluateServiceRelease(service, metrics) {
    const policy = this.policies[service];
    if (!policy) {
      throw new Error(`Unknown service for rollback evaluation: ${service}`);
    }

    const triggers = [];

    if (metrics.crashCount15m && metrics.crashCount15m >= policy.maxCrashCount15m) {
      triggers.push({
        severity: 'CRITICAL',
        code: 'SERVICE_CRASH_LOOP_DETECTED',
        message: `Service crashed ${metrics.crashCount15m} times in 15m (max: ${policy.maxCrashCount15m})`,
      });
    }

    if (service === 'indexer' && metrics.cursorLagLedgers > policy.maxCursorLagLedgers) {
      triggers.push({
        severity: 'HIGH',
        code: 'INDEXER_SYNC_LAG_EXCEEDED',
        message: `Indexer cursor lag of ${metrics.cursorLagLedgers} ledgers exceeds SLA threshold ${policy.maxCursorLagLedgers}`,
      });
    }

    if (service === 'notifications' && metrics.deliveryFailureRatePercent > policy.maxDeliveryFailureRatePercent) {
      triggers.push({
        severity: 'HIGH',
        code: 'NOTIFICATIONS_FAILURE_RATE_EXCEEDED',
        message: `Notification failure rate ${metrics.deliveryFailureRatePercent}% exceeds max ${policy.maxDeliveryFailureRatePercent}%`,
      });
    }

    if (service === 'oracle' && metrics.p99LatencySeconds > policy.maxP99LatencySeconds) {
      triggers.push({
        severity: 'HIGH',
        code: 'ORACLE_P99_LATENCY_DEGRADED',
        message: `Oracle p99 latency ${metrics.p99LatencySeconds}s exceeds max ${policy.maxP99LatencySeconds}s`,
      });
    }

    const shouldRollback = triggers.length > 0;
    return {
      component: service,
      shouldRollback,
      triggers,
      recommendedAction: shouldRollback ? 'TRIGGER_AUTOMATED_CANARY_ROLLBACK' : 'PROMOTE_CANARY_TO_STABLE',
      recoverySteps: shouldRollback ? [
        `Deregister canary instance for ${service}`,
        'Revert container image tag to previous stable digest',
        'Verify service SLIs stabilize on pre-release baseline',
      ] : [],
    };
  }
}

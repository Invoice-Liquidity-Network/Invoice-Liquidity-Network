/**
 * Notification Data Retention and Purge Policy (#1467, docs/privacy.md)
 *
 * ## Source of Truth & Storage Tiers
 * - `sent_notifications`: 30 days (recipient event delivery log)
 * - `webhook_delivery_logs`: 90 days (detailed HTTP attempt payloads and response headers)
 * - `delivery_audit_log`: 90 days (durable delivery audit records)
 * - `dispatch_attempts`: 90 days for terminal statuses ('delivered', 'failed')
 * - `redeemed_unsubscribe_tokens`: 90 days
 * - `compliance_audit_chain`: Append-only, tamper-evident SHA-256 HMAC chain (retained for auditability)
 *
 * ## Deletion Exceptions (#1467)
 * - In-flight or retrying dispatch attempts ('pending', 'retry_pending', 'in_progress')
 *   are NEVER deleted by the retention sweep, ensuring protocol retry safety.
 * - Max deletion safeguard: When eligible rows exceed `maxRows` (CONFIG.retentionMaxRows),
 *   deletion is aborted fail-closed with an alert to prevent catastrophic batch deletion.
 * - Dry-run mode: Calculates eligible rows and logs audit records without mutating live data.
 */

import { CONFIG } from './config';
import { purgeExpiredDeliveryLogs } from './db';

export interface RetentionPolicySummary {
  sentNotificationsDays: number;
  webhookDeliveryLogsDays: number;
  deliveryAuditLogDays: number;
  dispatchAttemptsDays: number;
  redeemedTokensDays: number;
  deletionExceptions: string[];
}

export const RETENTION_POLICY: RetentionPolicySummary = {
  sentNotificationsDays: 30,
  webhookDeliveryLogsDays: 90,
  deliveryAuditLogDays: 90,
  dispatchAttemptsDays: 90,
  redeemedTokensDays: 90,
  deletionExceptions: [
    "dispatch_attempts with non-terminal status ('pending', 'retry_pending', 'in_progress')",
    'compliance_audit_chain append-only HMAC chain',
    'active recipient subscription records until unsubscription',
  ],
};

export function getRetentionPolicySummary(): RetentionPolicySummary {
  return { ...RETENTION_POLICY };
}

export interface RetentionSweepOptions {
  dryRun?: boolean;
  maxRows?: number;
  now?: number;
}

export function runRetentionSweep(options: RetentionSweepOptions = {}) {
  const dryRun = options.dryRun ?? CONFIG.retentionDryRun;
  const result = purgeExpiredDeliveryLogs(options.now ?? Date.now(), {
    dryRun,
    maxRows: options.maxRows ?? CONFIG.retentionMaxRows,
  });

  if (result.alertThresholdExceeded) {
    console.error(
      `[retention] ALERT: ${result.totalEligible} expired notification records exceed the deletion limit; deletion skipped. Review retention_deletion_audit before raising RETENTION_MAX_DELETE_ROWS.`
    );
  } else {
    console.log(
      `[retention] ${dryRun ? 'Dry run' : 'Deletion'} completed: ${result.totalEligible} eligible, ${result.sentNotifications + result.webhookLogs + result.auditLogs + result.dispatchAttempts + result.redeemedTokens} deleted.`
    );
  }
  return result;
}

export function startRetentionScheduler(): NodeJS.Timeout {
  const sweep = () => {
    try {
      runRetentionSweep();
    } catch (error) {
      console.error('[retention] Scheduled retention sweep failed', error);
    }
  };

  sweep();
  const timer = setInterval(sweep, CONFIG.retentionSweepIntervalMs);
  timer.unref?.();
  return timer;
}

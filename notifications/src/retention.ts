import { CONFIG } from './config';
import { purgeExpiredDeliveryLogs } from './db';

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
// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { notificationsMetrics } from '../src/metrics';

describe('Issue #1276: Duplicate notification delivery idempotency', () => {
  beforeEach(async () => {
    notificationsMetrics.registry.resetMetrics();
  });

  it('tracks duplicate notification skips with channel and trigger dimensions', async () => {
    notificationsMetrics.recordDuplicateSkipped('webhook', 'invoice_paid');
    notificationsMetrics.recordDuplicateSkipped('webhook', 'invoice_paid');
    notificationsMetrics.recordDuplicateSkipped('email', 'invoice_due_soon');

    const metricsStr = await notificationsMetrics.registry.metrics();
    expect(metricsStr).toContain('iln_notifications_duplicates_skipped_total{channel="webhook",trigger="invoice_paid"} 2');
    expect(metricsStr).toContain('iln_notifications_duplicates_skipped_total{channel="email",trigger="invoice_due_soon"} 1');
  });
});

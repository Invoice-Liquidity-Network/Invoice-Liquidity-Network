import { describe, it, expect, beforeEach } from 'vitest';
import { createNotificationsMetrics, type NotificationsMetrics } from '../src/metrics';

describe('Delivery SLO Metrics (#1471)', () => {
  let metrics: NotificationsMetrics;

  beforeEach(() => {
    metrics = createNotificationsMetrics();
  });

  describe('Retry SLO metrics', () => {
    it('tracks retry attempts distribution across channels', async () => {
      metrics.recordRetry('email', 1);
      metrics.recordRetry('email', 1);
      metrics.recordRetry('email', 2);
      metrics.recordRetry('webhook', 1);

      const retryMetric = await metrics.retryAttemptsTotal.get();
      const emailAttempt1 = retryMetric.values.find(
        (v) => v.labels.channel === 'email' && v.labels.attempt === '1'
      );
      const emailAttempt2 = retryMetric.values.find(
        (v) => v.labels.channel === 'email' && v.labels.attempt === '2'
      );
      const webhookAttempt1 = retryMetric.values.find(
        (v) => v.labels.channel === 'webhook' && v.labels.attempt === '1'
      );

      expect(emailAttempt1?.value).toBe(2);
      expect(emailAttempt2?.value).toBe(1);
      expect(webhookAttempt1?.value).toBe(1);
    });

    it('records retry exhaustion and increments SLO breach counter when retries are exhausted', async () => {
      metrics.recordRetry('email', 3, true);

      const exhaustionMetric = await metrics.retryExhaustionTotal.get();
      const emailExhausted = exhaustionMetric.values.find((v) => v.labels.channel === 'email');
      expect(emailExhausted?.value).toBe(1);

      const breachMetric = await metrics.sloBreachesTotal.get();
      const retryBreach = breachMetric.values.find(
        (v) => v.labels.channel === 'email' && v.labels.slo_type === 'retry_exhaustion'
      );
      expect(retryBreach?.value).toBe(1);
    });

    it('tracks active in-flight retries gauge', async () => {
      metrics.activeRetries.set({ channel: 'email' }, 3);
      let metric = await metrics.activeRetries.get();
      expect(metric.values.find((v) => v.labels.channel === 'email')?.value).toBe(3);

      metrics.activeRetries.set({ channel: 'email' }, 0);
      metric = await metrics.activeRetries.get();
      expect(metric.values.find((v) => v.labels.channel === 'email')?.value).toBe(0);
    });
  });

  describe('Latency SLO metrics', () => {
    it('observes delivery duration in SLO-specific latency histogram buckets', async () => {
      metrics.recordDeliveryLatencySlo('email', 0.15); // 150ms (in SLO)
      metrics.recordDeliveryLatencySlo('email', 0.45); // 450ms (in SLO)

      const histogram = await metrics.deliveryLatencySlo.get();
      const bucket05 = histogram.values.find(
        (v) => v.labels.channel === 'email' && Number((v.labels as any).le) === 0.5
      );
      expect(bucket05?.value).toBe(2);

      // In SLO, no breach recorded
      const breaches = await metrics.sloBreachesTotal.get();
      const latencyBreach = breaches.values.find(
        (v) => v.labels.channel === 'email' && v.labels.slo_type === 'latency_p95'
      );
      expect(latencyBreach?.value).toBeUndefined();
    });

    it('flags SLO breach when delivery duration exceeds p95 target (500ms)', async () => {
      metrics.recordDeliveryLatencySlo('webhook', 0.85); // 850ms (> 500ms threshold)

      const breaches = await metrics.sloBreachesTotal.get();
      const latencyBreach = breaches.values.find(
        (v) => v.labels.channel === 'webhook' && v.labels.slo_type === 'latency_p95'
      );
      expect(latencyBreach?.value).toBe(1);
    });
  });

  describe('Failures categorized by error type', () => {
    it('records and classifies delivery failures by error category', async () => {
      metrics.recordFailureByType('webhook', 'timeout');
      metrics.recordFailureByType('webhook', 'timeout');
      metrics.recordFailureByType('webhook', 'http_503');
      metrics.recordFailureByType('email', 'circuit_open');

      const failureMetric = await metrics.failuresByErrorTypeTotal.get();
      const timeoutFailures = failureMetric.values.find(
        (v) => v.labels.channel === 'webhook' && v.labels.error_type === 'timeout'
      );
      const http503Failures = failureMetric.values.find(
        (v) => v.labels.channel === 'webhook' && v.labels.error_type === 'http_503'
      );
      const circuitFailures = failureMetric.values.find(
        (v) => v.labels.channel === 'email' && v.labels.error_type === 'circuit_open'
      );

      expect(timeoutFailures?.value).toBe(2);
      expect(http503Failures?.value).toBe(1);
      expect(circuitFailures?.value).toBe(1);
    });
  });

  describe('Dead-letter queue depth & alert threshold metrics', () => {
    it('tracks dead-letter queue additions and current depth gauge', async () => {
      metrics.recordDeadLetter('email', 'exhausted_retries', 4);

      const dlqTotal = await metrics.deadLetterTotal.get();
      expect(
        dlqTotal.values.find(
          (v) => v.labels.channel === 'email' && v.labels.reason === 'exhausted_retries'
        )?.value
      ).toBe(1);

      const depth = await metrics.deadLetterQueueDepth.get();
      expect(depth.values.find((v) => v.labels.channel === 'email')?.value).toBe(4);
    });

    it('triggers deadLetterAlertThresholdExceeded when DLQ depth reaches or exceeds 10', async () => {
      // Under threshold
      metrics.recordDeadLetter('webhook', 'unreachable', 5);
      let alertMetric = await metrics.deadLetterAlertThresholdExceeded.get();
      expect(alertMetric.values.find((v) => v.labels.channel === 'webhook')?.value).toBeUndefined();

      // At threshold (10)
      metrics.recordDeadLetter('webhook', 'unreachable', 10);
      alertMetric = await metrics.deadLetterAlertThresholdExceeded.get();
      expect(alertMetric.values.find((v) => v.labels.channel === 'webhook')?.value).toBe(1);

      // Above threshold (12)
      metrics.recordDeadLetter('webhook', 'unreachable', 12);
      alertMetric = await metrics.deadLetterAlertThresholdExceeded.get();
      expect(alertMetric.values.find((v) => v.labels.channel === 'webhook')?.value).toBe(2);
    });
  });

  describe('Provider health status SLO metrics', () => {
    it('reflects healthy = 1.0, degraded = 0.5, and unhealthy = 0.0', async () => {
      metrics.recordProviderHealthStatus('email', 'healthy');
      let health = await metrics.providerHealthStatus.get();
      expect(health.values.find((v) => v.labels.channel === 'email')?.value).toBe(1);

      metrics.recordProviderHealthStatus('email', 'degraded');
      health = await metrics.providerHealthStatus.get();
      expect(health.values.find((v) => v.labels.channel === 'email')?.value).toBe(0.5);

      metrics.recordProviderHealthStatus('email', 'unhealthy');
      health = await metrics.providerHealthStatus.get();
      expect(health.values.find((v) => v.labels.channel === 'email')?.value).toBe(0);
    });

    it('tracks cumulative provider outage duration', async () => {
      metrics.providerOutageDurationSeconds.inc({ channel: 'sms' }, 120);
      const metric = await metrics.providerOutageDurationSeconds.get();
      expect(metric.values.find((v) => v.labels.channel === 'sms')?.value).toBe(120);
    });
  });

  describe('Prometheus Registry integration', () => {
    it('exports all SLO metrics in valid Prometheus exposition text format', async () => {
      metrics.recordRetry('email', 1);
      metrics.recordDeliveryLatencySlo('email', 0.2);
      metrics.recordFailureByType('email', 'rate_limit');
      metrics.recordDeadLetter('email', 'timeout', 2);
      metrics.recordProviderHealthStatus('email', 'healthy');

      const output = await metrics.registry.metrics();
      expect(output).toContain('iln_notifications_retry_attempts_total');
      expect(output).toContain('iln_notifications_delivery_latency_slo_seconds');
      expect(output).toContain('iln_notifications_failures_by_error_type_total');
      expect(output).toContain('iln_notifications_dead_letter_total');
      expect(output).toContain('iln_notifications_dead_letter_queue_depth');
      expect(output).toContain('iln_notifications_provider_health_status');
    });
  });
});

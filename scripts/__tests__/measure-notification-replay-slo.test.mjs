import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationReplayBenchmark, DEFAULT_NOTIFICATION_SLO } from '../operations/measure-notification-replay-slo.mjs';

describe('Notification Recovery & Replay SLO Suite (#1318)', () => {
  it('measures batch DLQ replay and confirms all SLO criteria pass', () => {
    const bench = new NotificationReplayBenchmark();
    const batch = bench.simulateDlqBatch(200);
    const result = bench.executeReplay(batch);

    assert.equal(result.totalItemsReplayed, 200);
    assert.equal(result.successRatePercent, 100.0);
    assert.ok(result.duplicateDeliveriesBlocked > 0);
    assert.ok(result.p95LatencyMs <= DEFAULT_NOTIFICATION_SLO.maxP95LatencyMs);
    assert.ok(result.totalDurationSeconds <= DEFAULT_NOTIFICATION_SLO.maxRtoSeconds);
    assert.equal(result.sloMet, true);
  });

  it('enforces idempotency and prevents duplicate webhook deliveries on replay', () => {
    const bench = new NotificationReplayBenchmark();
    const duplicateItems = [
      { id: '1', idempotencyKey: 'same-key', invoiceId: 1 },
      { id: '2', idempotencyKey: 'same-key', invoiceId: 1 },
    ];
    const result = bench.executeReplay(duplicateItems);

    assert.equal(result.duplicateDeliveriesBlocked, 1);
    assert.equal(bench.deliveredKeys.size, 1);
  });
});

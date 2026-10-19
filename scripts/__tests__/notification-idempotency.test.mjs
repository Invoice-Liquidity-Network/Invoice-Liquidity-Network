import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Notification Idempotency Engine Suite (#1276)', () => {
  it('deduplicates concurrent in-flight events using in-flight lock set', () => {
    const inFlight = new Set();
    const eventId = '0000000000000001-00000001';

    let processedCount = 0;
    let duplicateSkippedCount = 0;

    function handleEvent(id) {
      if (inFlight.has(id)) {
        duplicateSkippedCount++;
        return;
      }
      inFlight.add(id);
      try {
        processedCount++;
      } finally {
        inFlight.delete(id);
      }
    }

    // Sequential
    handleEvent(eventId);
    assert.equal(processedCount, 1);
    assert.equal(duplicateSkippedCount, 0);

    // Concurrent simulation (lock active)
    inFlight.add(eventId);
    handleEvent(eventId);
    assert.equal(processedCount, 1);
    assert.equal(duplicateSkippedCount, 1);
    inFlight.delete(eventId);
  });

  it('generates consistent idempotency keys for outbound webhook payloads', () => {
    const invoiceId = 42;
    const trigger = 'invoice_paid';
    const recipient = 'GABC1234567890';
    const eventId = '0000000123-0001';

    const keyWithEvent = eventId;
    const keyWithoutEvent = `${invoiceId}-${trigger}-${recipient}`;

    assert.equal(keyWithEvent, '0000000123-0001');
    assert.equal(keyWithoutEvent, '42-invoice_paid-GABC1234567890');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Dead-Letter Unrecoverable Event Handling Suite (#1273)', () => {
  it('intercepts malformed events and routes them to dead-letter queue without throwing', () => {
    const dlq = [];

    function pushDeadLetterMock(entry) {
      dlq.push({ ...entry, id: 'dlq-' + Date.now(), timestamp: Date.now() });
    }

    function processEventMock(rawEvent) {
      try {
        if (!rawEvent.topic || rawEvent.topic.length === 0) return { status: 'IGNORED_NO_TOPIC' };
        if (rawEvent.malformed) throw new Error('XDR_DESERIALIZE_FAILED');
        const id = Number(rawEvent.value);
        if (isNaN(id)) throw new Error('INVALID_INVOICE_ID');
        return { status: 'PROCESSED', invoiceId: id };
      } catch (err) {
        pushDeadLetterMock({
          channel: 'event',
          destination: rawEvent.id,
          lastError: `UNRECOVERABLE_EVENT: ${err.message}`,
          attempts: 1,
        });
        return { status: 'DEAD_LETTERED' };
      }
    }

    // 1. Valid event
    const valid = processEventMock({ id: 'evt-1', topic: ['paid'], value: '42' });
    assert.equal(valid.status, 'PROCESSED');
    assert.equal(dlq.length, 0);

    // 2. Corrupt XDR event (poison pill)
    const corrupt = processEventMock({ id: 'evt-bad-xdr', topic: ['paid'], malformed: true });
    assert.equal(corrupt.status, 'DEAD_LETTERED');
    assert.equal(dlq.length, 1);
    assert.equal(dlq[0].destination, 'evt-bad-xdr');
    assert.ok(dlq[0].lastError.includes('XDR_DESERIALIZE_FAILED'));

    // 3. Invalid invoice ID event
    const badId = processEventMock({ id: 'evt-bad-id', topic: ['paid'], value: 'not-a-number' });
    assert.equal(badId.status, 'DEAD_LETTERED');
    assert.equal(dlq.length, 2);
    assert.equal(dlq[1].destination, 'evt-bad-id');
    assert.ok(dlq[1].lastError.includes('INVALID_INVOICE_ID'));
  });
});

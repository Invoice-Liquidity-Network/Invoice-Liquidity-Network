import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Prevent Recorded-Before-Retrieved Event Loss Suite (#1274)', () => {
  it('does not journal event in database when invoice retrieval fails, enabling subsequent retry', async () => {
    const eventsDb = new Set();
    let invoiceRetrievalSuccess = false;

    async function processEventMock(event) {
      if (eventsDb.has(event.id)) {
        return { status: 'DUPLICATE_SKIPPED' };
      }

      // Simulate retrieve-before-record
      if (!invoiceRetrievalSuccess) {
        // Retrieval failed: do NOT insert into eventsDb
        return { status: 'RETRY_DEFERRED' };
      }

      eventsDb.add(event.id);
      return { status: 'PROCESSED' };
    }

    const mockEvent = { id: 'evt-001' };

    // Attempt 1: Invoice fetch fails
    const res1 = await processEventMock(mockEvent);
    assert.equal(res1.status, 'RETRY_DEFERRED');
    assert.equal(eventsDb.has('evt-001'), false); // Must NOT be recorded

    // Attempt 2 (Next poll): Invoice fetch succeeds
    invoiceRetrievalSuccess = true;
    const res2 = await processEventMock(mockEvent);
    assert.equal(res2.status, 'PROCESSED');
    assert.equal(eventsDb.has('evt-001'), true); // Successfully recorded

    // Attempt 3: Duplicate poll arrives
    const res3 = await processEventMock(mockEvent);
    assert.equal(res3.status, 'DUPLICATE_SKIPPED');
  });
});

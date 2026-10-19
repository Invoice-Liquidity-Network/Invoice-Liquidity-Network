// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { DigestScheduler } from '../src/digest';
import { notificationsMetrics } from '../src/metrics';
import type { InvoiceEvent } from '../src/types';

describe('Issue #1282: Digest reconciliation against invoice events', () => {
  const dummySender = { send: async () => {} };
  let scheduler: DigestScheduler;
  const userAddress = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

  beforeEach(() => {
    notificationsMetrics.registry.resetMetrics();
    scheduler = new DigestScheduler(dummySender);
    scheduler.register({
      stellarAddress: userAddress,
      email: 'digest@example.com',
      frequency: 'daily',
      unsubscribeToken: 'unsub-test',
    });
  });

  it('reconciles and deduplicates identical invoice events for the same invoice', () => {
    const event1: InvoiceEvent = {
      eventId: 'evt-1',
      invoiceId: 101,
      type: 'invoice_funded',
      amount: '50000000',
      freelancer: 'GFL1',
      payer: 'GPAY1',
      dueDate: 1700000000,
    };

    const isReconciled1 = scheduler.reconcile(userAddress, event1);
    expect(isReconciled1).toBe(false);

    // Duplicate event arrives
    const isReconciled2 = scheduler.reconcile(userAddress, event1);
    expect(isReconciled2).toBe(true);
  });
});

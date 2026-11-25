import { describe, it, expect, beforeEach } from 'vitest';
import {
  DigestScheduler,
  deduplicateDigestItems,
  groupDigestItemsByInvoice,
} from '../src/digest';
import type { InvoiceEvent } from '../src/types';

describe('Notification Digest Grouping and Deduplication Audit (#1464)', () => {
  let mockSender: { calls: Array<{ to: string; subject: string; html: string }> };

  beforeEach(() => {
    mockSender = { calls: [] };
  });

  const baseEvent = (overrides: Partial<InvoiceEvent> = {}): InvoiceEvent => ({
    eventId: 'evt-100',
    type: 'funded',
    invoiceId: 42,
    amount: '1000',
    freelancer: 'G_FREELANCER',
    payer: 'G_PAYER',
    dueDate: Math.floor(Date.now() / 1000) + 86400,
    ...overrides,
  });

  describe('Deduplication in DigestScheduler.buffer', () => {
    it('discards duplicate events with matching eventId during replay bursts', () => {
      const scheduler = new DigestScheduler({
        send: async (to, subject, html) => {
          mockSender.calls.push({ to, subject, html });
        },
      });

      scheduler.register({
        stellarAddress: 'G_RECIPIENT',
        email: 'recipient@example.com',
        frequency: 'daily',
        unsubscribeToken: 'unsub-test',
      });

      // Buffer original event
      scheduler.buffer('G_RECIPIENT', baseEvent({ eventId: 'evt-100', invoiceId: 1 }));
      // Buffer duplicate replay with same eventId
      scheduler.buffer('G_RECIPIENT', baseEvent({ eventId: 'evt-100', invoiceId: 1 }));
      // Buffer duplicate replay again
      scheduler.buffer('G_RECIPIENT', baseEvent({ eventId: 'evt-100', invoiceId: 1 }));

      const buffer = (scheduler as any).buffers.get('G_RECIPIENT');
      expect(buffer.items).toHaveLength(1);
      expect(buffer.items[0].eventId).toBe('evt-100');
    });

    it('deduplicates events missing eventId by invoiceId and eventType', () => {
      const scheduler = new DigestScheduler({
        send: async (to, subject, html) => {
          mockSender.calls.push({ to, subject, html });
        },
      });

      scheduler.register({
        stellarAddress: 'G_RECIPIENT',
        email: 'recipient@example.com',
        frequency: 'daily',
        unsubscribeToken: 'unsub-test',
      });

      // Buffer event without eventId
      scheduler.buffer('G_RECIPIENT', baseEvent({ eventId: undefined, invoiceId: 5, type: 'paid' }));
      // Buffer same invoice event without eventId
      scheduler.buffer('G_RECIPIENT', baseEvent({ eventId: undefined, invoiceId: 5, type: 'paid' }));

      const buffer = (scheduler as any).buffers.get('G_RECIPIENT');
      expect(buffer.items).toHaveLength(1);
      expect(buffer.items[0].invoiceId).toBe(5);
    });

    it('buffers distinct lifecycle event types for the same invoice', () => {
      const scheduler = new DigestScheduler({
        send: async (to, subject, html) => {
          mockSender.calls.push({ to, subject, html });
        },
      });

      scheduler.register({
        stellarAddress: 'G_RECIPIENT',
        email: 'recipient@example.com',
        frequency: 'daily',
        unsubscribeToken: 'unsub-test',
      });

      scheduler.buffer('G_RECIPIENT', baseEvent({ eventId: 'evt-1', invoiceId: 10, type: 'funded' }));
      scheduler.buffer('G_RECIPIENT', baseEvent({ eventId: 'evt-2', invoiceId: 10, type: 'paid' }));

      const buffer = (scheduler as any).buffers.get('G_RECIPIENT');
      expect(buffer.items).toHaveLength(2);
      expect(buffer.items.map((i: any) => i.eventType)).toEqual(['funded', 'paid']);
    });
  });

  describe('groupDigestItemsByInvoice & deduplicateDigestItems helpers', () => {
    it('deduplicates raw digest item lists containing duplicate events', () => {
      const items = [
        {
          eventId: 'e-1',
          invoiceId: 101,
          eventType: 'funded',
          amount: '500',
          freelancer: 'G1',
          payer: 'G2',
          dueDate: 12345,
          occurredAt: 1000,
        },
        {
          eventId: 'e-1',
          invoiceId: 101,
          eventType: 'funded',
          amount: '500',
          freelancer: 'G1',
          payer: 'G2',
          dueDate: 12345,
          occurredAt: 1005,
        },
        {
          eventId: 'e-2',
          invoiceId: 102,
          eventType: 'paid',
          amount: '750',
          freelancer: 'G1',
          payer: 'G2',
          dueDate: 12345,
          occurredAt: 1010,
        },
      ];

      const deduped = deduplicateDigestItems(items);
      expect(deduped).toHaveLength(2);
      expect(deduped[0].eventId).toBe('e-1');
      expect(deduped[1].eventId).toBe('e-2');
    });

    it('groups multiple events under their respective invoice IDs', () => {
      const items = [
        {
          eventId: 'e-1',
          invoiceId: 101,
          eventType: 'funded',
          amount: '500',
          freelancer: 'G1',
          payer: 'G2',
          dueDate: 12345,
          occurredAt: 1000,
        },
        {
          eventId: 'e-2',
          invoiceId: 101,
          eventType: 'paid',
          amount: '500',
          freelancer: 'G1',
          payer: 'G2',
          dueDate: 12345,
          occurredAt: 1050,
        },
        {
          eventId: 'e-3',
          invoiceId: 102,
          eventType: 'funded',
          amount: '800',
          freelancer: 'G3',
          payer: 'G4',
          dueDate: 12345,
          occurredAt: 1080,
        },
      ];

      const grouped = groupDigestItemsByInvoice(items);
      expect(grouped.size).toBe(2);
      expect(grouped.get(101)).toHaveLength(2);
      expect(grouped.get(102)).toHaveLength(1);
    });
  });
});

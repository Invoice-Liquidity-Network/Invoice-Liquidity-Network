/**
 * Recipient routing shared by the processor and digest reconciliation
 * (#1282), so both agree on who should hear about an invoice event.
 */

import type { Invoice, ILNEventType, NotificationTrigger } from './types';

export type NotificationActor = 'freelancer' | 'lp' | 'payer';

export const EVENT_TO_TRIGGER: Record<ILNEventType, NotificationTrigger | null> = {
  submitted: null,
  funded: 'invoice_funded',
  paid: 'invoice_paid',
  defaulted: 'invoice_defaulted',
};

export function getNotificationTargets(
  trigger: NotificationTrigger,
  invoice: Pick<Invoice, 'freelancer' | 'payer' | 'funder'>
): Array<{ recipient: string; actor: NotificationActor }> {
  switch (trigger) {
    case 'invoice_funded':
      return [
        { recipient: invoice.freelancer, actor: 'freelancer' },
        { recipient: invoice.payer, actor: 'payer' },
      ];
    case 'invoice_paid': {
      const targets: Array<{ recipient: string; actor: NotificationActor }> = [
        { recipient: invoice.freelancer, actor: 'freelancer' },
      ];
      if (invoice.funder) {
        targets.push({ recipient: invoice.funder, actor: 'lp' });
      }
      return targets;
    }
    case 'invoice_defaulted':
      if (!invoice.funder) {
        return [];
      }
      return [{ recipient: invoice.funder, actor: 'lp' }];
    case 'invoice_due_soon':
      if (!invoice.funder) {
        return [];
      }
      return [{ recipient: invoice.funder, actor: 'lp' }];
    case 'invoice_overdue':
      return [{ recipient: invoice.payer, actor: 'payer' }];
    default:
      return [];
  }
}

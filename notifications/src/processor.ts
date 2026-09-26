import type { rpc } from '@stellar/stellar-sdk';
import { scValToNative } from '@stellar/stellar-sdk';
import {
  hasEvent,
  insertEvent,
  upsertInvoice,
  queryInvoicesByStatus,
  getSubscriptionsByAddress,
  hasSentNotification,
  logSentNotification,
  enqueueDispatchAttempt,
  getPendingDispatchAttempts,
  markDispatchAttemptDelivered,
  recordDispatchAttemptFailure,
  dispatchDestinationOf,
} from './db';
import { fetchInvoice } from './rpc';
import { deliverNotification } from './delivery';
import { deliverWithFallback } from './fallback';
import { getProviderHealth } from './provider-health';
import { digestScheduler, DigestScheduler } from './digest';
import { preferencesService } from './preferences';
import type { Invoice, ILNEventType, NotificationTrigger, InvoiceEvent } from './types';
import { CONFIG } from './config';

const KNOWN_EVENT_TYPES = new Set<ILNEventType>(['submitted', 'funded', 'paid', 'defaulted']);

const EVENT_TO_TRIGGER: Record<ILNEventType, NotificationTrigger | null> = {
  submitted: null,
  funded: 'invoice_funded',
  paid: 'invoice_paid',
  defaulted: 'invoice_defaulted',
};

export async function processEvent(event: rpc.Api.EventResponse): Promise<void> {
  if (hasEvent(event.id)) {
    return;
  }

  if (!event.topic || event.topic.length === 0) {
    return;
  }

  const eventType = scValToNative(event.topic[0]) as string;
  if (!KNOWN_EVENT_TYPES.has(eventType as ILNEventType)) {
    return;
  }

  const invoiceId = Number(scValToNative(event.value) as bigint);
  insertEvent({
    event_id: event.id,
    event_type: eventType as ILNEventType,
    invoice_id: invoiceId,
    ledger: event.ledger,
    ledger_closed_at: event.ledgerClosedAt,
    created_at: Date.now(),
  });

  const invoice = await fetchInvoice(invoiceId);
  if (!invoice) {
    return;
  }

  upsertInvoice(invoice);
  const trigger = EVENT_TO_TRIGGER[eventType as ILNEventType];
  if (trigger) {
    await dispatchNotifications(trigger, invoice, event.id as string);
  }
}

export async function processScheduledNotifications(): Promise<void> {
  await notifyDueSoon();
  await notifyOverdue();
}

/**
 * Resume the durable dispatch queue (issue #1059).
 *
 * Every notification is written to `dispatch_attempts` before its first
 * provider call, so anything still `pending` after a crash — or after a
 * transient failure — is unfinished work rather than a lost notification. This
 * runs at the end of every poll, which makes the poller the retry driver: no
 * in-process timer has to survive the restart.
 *
 * A row is only re-sent if it was never confirmed delivered:
 * - `getPendingDispatchAttempts()` returns `pending` rows only, so an
 *   already-delivered notification cannot be picked up again;
 * - `sent_notifications` is checked first, covering the window where the
 *   provider call succeeded but the process died before the attempt row was
 *   closed out — that row is completed instead of re-sent;
 * - `markDispatchAttemptDelivered()` returns false if another flush already
 *   closed the row, and the caller then skips the "sent" bookkeeping.
 *
 * One failing delivery is logged and left pending; it never aborts the rest of
 * the flush.
 */
export async function flushPendingNotifications(): Promise<void> {
  const pending = getPendingDispatchAttempts();
  for (const attempt of pending) {
    const { invoice, trigger, recipientAddress } = attempt.payload;
    const channel = attempt.subscription.channel;
    const destination = dispatchDestinationOf(attempt.subscription);

    if (hasSentNotification(invoice.id, trigger, recipientAddress, channel, destination)) {
      markDispatchAttemptDelivered(attempt.id);
      continue;
    }

    try {
      await deliverNotification(attempt.subscription, attempt.payload);
      if (markDispatchAttemptDelivered(attempt.id)) {
        logSentNotification(
          invoice.id,
          trigger,
          recipientAddress,
          channel,
          destination,
          attempt.event_id ?? undefined
        );
      }
    } catch (error: any) {
      recordDispatchAttemptFailure(attempt.id, error?.message ?? String(error));
      console.error(`[processor] Failed to deliver pending notification ${attempt.id}:`, error);
    }
  }
}

async function notifyDueSoon(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now + CONFIG.dueWarningHours * 3600;
  const invoices = queryInvoicesByStatus('Funded');

  for (const invoice of invoices) {
    if (invoice.due_date <= now || invoice.due_date > cutoff) {
      continue;
    }

    await dispatchNotifications('invoice_due_soon', invoice);
  }
}

async function notifyOverdue(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const invoices = queryInvoicesByStatus('Funded');

  for (const invoice of invoices) {
    if (invoice.due_date >= now) {
      continue;
    }

    await dispatchNotifications('invoice_overdue', invoice);
  }
}

function getNotificationTargets(
  trigger: NotificationTrigger,
  invoice: Invoice
): Array<{ recipient: string; actor: 'freelancer' | 'lp' | 'payer' }> {
  switch (trigger) {
    case 'invoice_funded':
      return [
        { recipient: invoice.freelancer, actor: 'freelancer' },
        { recipient: invoice.payer, actor: 'payer' },
      ];
    case 'invoice_paid': {
      const targets: Array<{
        recipient: string;
        actor: 'freelancer' | 'lp' | 'payer';
      }> = [{ recipient: invoice.freelancer, actor: 'freelancer' }];
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

function formatPayload(
  trigger: NotificationTrigger,
  invoice: Invoice,
  recipient: string,
  actor: 'freelancer' | 'lp' | 'payer'
): { subject: string; message: string } {
  switch (trigger) {
    case 'invoice_funded':
      if (actor === 'freelancer') {
        return {
          subject: `Invoice #${invoice.id} funded`,
          message: `Your invoice #${invoice.id} has been funded for ${invoice.amount} stroops.`,
        };
      }
      return {
        subject: `Invoice #${invoice.id} funding reminder`,
        message: `Invoice #${invoice.id} is funded and payment is due.`,
      };
    case 'invoice_paid':
      if (actor === 'lp') {
        return {
          subject: `Invoice #${invoice.id} has been paid`,
          message: `Invoice #${invoice.id} was settled. Your loan has been repaid.`,
        };
      }
      return {
        subject: `Invoice #${invoice.id} paid`,
        message: `Invoice #${invoice.id} has been marked as paid.`,
      };
    case 'invoice_defaulted':
      return {
        subject: `Invoice #${invoice.id} defaulted`,
        message: `Invoice #${invoice.id} has defaulted and requires attention.`,
      };
    case 'invoice_due_soon':
      return {
        subject: `Invoice #${invoice.id} due in ${CONFIG.dueWarningHours} hours`,
        message: `Invoice #${invoice.id} is approaching its due date at ${new Date(
          invoice.due_date * 1000
        ).toISOString()}.`,
      };
    case 'invoice_overdue':
      return {
        subject: `Invoice #${invoice.id} overdue`,
        message: `Invoice #${invoice.id} is overdue. Payment is now past due.`,
      };
    default:
      return {
        subject: `Invoice #${invoice.id} notification`,
        message: `Invoice #${invoice.id} has an update.`,
      };
  }
}

const TRIGGER_TO_EVENT_TYPE: Record<NotificationTrigger, ILNEventType | null> = {
  invoice_funded: 'funded',
  invoice_paid: 'paid',
  invoice_defaulted: 'defaulted',
  invoice_due_soon: null,
  invoice_overdue: null,
};

function triggerToEventType(trigger: NotificationTrigger): ILNEventType | undefined {
  return TRIGGER_TO_EVENT_TYPE[trigger] ?? undefined;
}

async function dispatchNotifications(
  trigger: NotificationTrigger,
  invoice: Invoice,
  eventId?: string
): Promise<void> {
  const targets = getNotificationTargets(trigger, invoice);
  for (const target of targets) {
    // Check user's digest preference — if daily or weekly, buffer instead of immediate send.
    const prefs = preferencesService.get(target.recipient);
    if (DigestScheduler.isDigestFrequency(prefs.frequency)) {
      const invoiceEvent: InvoiceEvent = {
        eventId: eventId ?? `digest-${invoice.id}-${Date.now()}`,
        invoiceId: invoice.id,
        type: triggerToEventType(trigger) ?? trigger,
        amount: invoice.amount,
        freelancer: invoice.freelancer,
        payer: invoice.payer,
        dueDate: invoice.due_date,
        discountRate: invoice.discount_rate,
        funder: invoice.funder,
      };
      digestScheduler.register({
        stellarAddress: target.recipient,
        email: target.recipient, // would use real email from user profile in production
        frequency: prefs.frequency,
        sendHour: 8,
        sendDayOfWeek: 1,
        unsubscribeToken: `${target.recipient}-unsub`,
      });
      digestScheduler.buffer(target.recipient, invoiceEvent);
      continue;
    }

    const subscriptions = getSubscriptionsByAddress(target.recipient);
    const matchingSubscriptions = subscriptions.filter((subscription) =>
      subscription.triggers.includes(trigger)
    );

    for (const subscription of matchingSubscriptions) {
      const alreadySent = hasSentNotification(
        invoice.id,
        trigger,
        target.recipient,
        subscription.channel,
        dispatchDestinationOf(subscription)
      );
      if (alreadySent) {
        continue;
      }

      const payload = {
        trigger,
        invoice,
        recipientAddress: target.recipient,
        actor: target.actor,
        eventId,
        eventType: eventId ? triggerToEventType(trigger) : undefined,
        ...formatPayload(trigger, invoice, target.recipient, target.actor),
      };

      // Issue #1059: the intent to deliver is written durably *before* the first
      // provider call. If this process dies mid-dispatch, or the provider fails,
      // the row stays `pending` and the poller's flush retries it, so delivery is
      // at-least-once rather than best-effort. The enqueue is `INSERT OR IGNORE`
      // on a UNIQUE dedup key, so a duplicated event or a replayed poll can
      // neither queue nor send a second copy of the same notification.
      const attempt = enqueueDispatchAttempt(subscription, payload);
      if (attempt.alreadyDelivered) {
        // Some earlier run already confirmed this exact notification.
        continue;
      }

      try {
        // Check provider health and route via fallback if degraded, with
        // priority-aware capacity handling. Critical alerts are never shed.
        const health = getProviderHealth(subscription.channel as any);
        if (health !== 'healthy') {
          const fbResult = await deliverWithFallback(subscription, payload);
          if (fbResult.success) {
            const usedChannel = (fbResult.fallbackChannel as any) ?? subscription.channel;
            // Find the actual destination used for the fallback channel
            let usedDestination = dispatchDestinationOf(subscription);
            if (fbResult.fallbackChannel) {
              const fallbackSubs = getSubscriptionsByAddress(target.recipient).filter(
                (s) => s.channel === fbResult.fallbackChannel && s.triggers.includes(trigger)
              );
              if (fallbackSubs.length > 0) usedDestination = dispatchDestinationOf(fallbackSubs[0]);
            }
            // The recipient was reached, just not on the primary channel: close
            // the primary attempt so the flush does not send it a second time.
            markDispatchAttemptDelivered(attempt.id);
            logSentNotification(
              invoice.id,
              trigger,
              target.recipient,
              usedChannel,
              usedDestination,
              eventId
            );
          } else if (!fbResult.capacityAllowed) {
            recordDispatchAttemptFailure(
              attempt.id,
              fbResult.error ?? `fallback capacity exhausted for ${trigger}`
            );
            console.warn(
              `[processor] Fallback capacity exhausted for ${trigger} to ${target.recipient} (priority ${fbResult.priority}) — shedding low-priority notification`
            );
          } else {
            recordDispatchAttemptFailure(attempt.id, fbResult.error ?? 'fallback delivery failed');
            console.error(
              `[processor] Failed to deliver notification for invoice ${
                invoice.id
              } to ${dispatchDestinationOf(subscription)} via fallback:`,
              fbResult.error
            );
          }
        } else {
          await deliverNotification(subscription, payload);
          markDispatchAttemptDelivered(attempt.id);
          logSentNotification(
            invoice.id,
            trigger,
            target.recipient,
            subscription.channel,
            dispatchDestinationOf(subscription),
            eventId
          );
        }
      } catch (error) {
        const primaryError = error instanceof Error ? error.message : String(error);
        // Direct delivery failure — try fallback as second chance for critical
        try {
          const fbResult = await deliverWithFallback(subscription, payload);
          if (fbResult.success) {
            const usedChannel = (fbResult.fallbackChannel as any) ?? subscription.channel;
            let usedDestination = dispatchDestinationOf(subscription);
            if (fbResult.fallbackChannel) {
              const fallbackSubs = getSubscriptionsByAddress(target.recipient).filter(
                (s) => s.channel === fbResult.fallbackChannel && s.triggers.includes(trigger)
              );
              if (fallbackSubs.length > 0) usedDestination = dispatchDestinationOf(fallbackSubs[0]);
            }
            markDispatchAttemptDelivered(attempt.id);
            logSentNotification(
              invoice.id,
              trigger,
              target.recipient,
              usedChannel,
              usedDestination,
              eventId
            );
          } else {
            // Row stays pending: the poller flush owns the retry from here.
            // The provider that refused the send is the actionable cause, so it
            // is kept even when the fallback reports its own reason.
            recordDispatchAttemptFailure(
              attempt.id,
              fbResult.error ? `${primaryError} (fallback: ${fbResult.error})` : primaryError
            );
            console.error(
              `[processor] Failed to deliver notification for invoice ${
                invoice.id
              } to ${dispatchDestinationOf(subscription)}:`,
              error
            );
          }
        } catch (fallbackError) {
          recordDispatchAttemptFailure(
            attempt.id,
            `${primaryError} (fallback: ${
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            })`
          );
          console.error(
            `[processor] Failed to deliver notification for invoice ${
              invoice.id
            } to ${dispatchDestinationOf(subscription)}:`,
            fallbackError
          );
        }
      }
    }
  }
}

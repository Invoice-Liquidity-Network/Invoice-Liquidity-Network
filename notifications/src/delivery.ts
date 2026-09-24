import { createHmac } from 'crypto';
import { Resend } from 'resend';
import Twilio from 'twilio';
import { CONFIG } from './config';
import { createWebhookDeliveryLog, updateWebhookDeliveryLog } from './db';
import type { NotificationPayload, Subscription, NotificationTrigger, Invoice } from './types';

const resend = new Resend(CONFIG.resendApiKey);

let twilioClient: ReturnType<typeof Twilio> | null = null;

function getTwilioClient() {
  if (!twilioClient && CONFIG.twilioAccountSid && CONFIG.twilioAuthToken) {
    twilioClient = Twilio(CONFIG.twilioAccountSid, CONFIG.twilioAuthToken);
  }
  return twilioClient;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DeadLetterEntry {
  /** Stable operator-facing identifier (timestamp-rand suffix). */
  id: string;
  channel: 'email' | 'sms' | 'webhook';
  destination: string;
  subscriptionId: string;
  trigger: NotificationTrigger;
  invoice: Invoice;
  subject: string;
  message: string;
  lastError: string;
  attempts: number;
  timestamp: number;
}

export interface RetryMetrics {
  totalRetries: number;
  activeRetries: number;
  deadLetterCount: number;
  deadLetterEntries: DeadLetterEntry[];
}

export const MAX_RETRIES = 3;
export const MAX_RETRY_DELAY_MS = 30000;
export const DLQ_ALERT_THRESHOLD = 10;

const MAX_RETRY_DELAY = MAX_RETRY_DELAY_MS;

const deadLetterQueue: DeadLetterEntry[] = [];
let totalRetries = 0;
let activeRetries = 0;

function newDeadLetterId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushDeadLetter(entry: Omit<DeadLetterEntry, 'id' | 'timestamp'>): DeadLetterEntry {
  const full: DeadLetterEntry = { ...entry, id: newDeadLetterId(), timestamp: Date.now() };
  deadLetterQueue.push(full);
  checkDlqAlertThreshold();
  return full;
}
function checkDlqAlertThreshold(): void {
  if (deadLetterQueue.length > DLQ_ALERT_THRESHOLD) {
    console.warn(
      `[DLQ ALERT] Dead-letter queue accumulation exceeds threshold: ${deadLetterQueue.length} > ${DLQ_ALERT_THRESHOLD}`
    );
  }
}

export function getRetryMetrics(): RetryMetrics {
  return {
    totalRetries,
    activeRetries,
    deadLetterCount: deadLetterQueue.length,
    deadLetterEntries: [...deadLetterQueue],
  };
}

export function clearDeadLetterQueue(): void {
  deadLetterQueue.length = 0;
}

export function getDeadLetterEntries(): DeadLetterEntry[] {
  return [...deadLetterQueue];
}

export function getDeadLetterCount(): number {
  return deadLetterQueue.length;
}

export function replayDeadLetter(entryId: string): void {
  const entry = deadLetterQueue.find((e) => e.id === entryId || String(e.timestamp) === entryId);
  if (!entry) {
    throw new Error(`Dead-letter entry with id ${entryId} not found`);
  }

  const subscription = {
    id: entry.subscriptionId,
    address: entry.destination,
    channel: entry.channel,
    destination: entry.destination,
    email: entry.channel === 'email' ? entry.destination : undefined,
    webhookUrl: entry.channel === 'webhook' ? entry.destination : undefined,
    webhook_secret: entry.channel === 'webhook' ? '' : undefined,
    webhookStatus: 'active' as const,
    active: true,
  };

  const payload: NotificationPayload = {
    trigger: entry.trigger,
    invoice: entry.invoice,
    recipientAddress: entry.destination,
    subject: entry.subject,
    message: entry.message,
    actor: 'freelancer',
  };

  deadLetterQueue.splice(deadLetterQueue.indexOf(entry), 1);
  // Note: deliverNotification dead-letters internally on exhaustion (email
  // and SMS via retryWithBackoff's onDeadLetter, webhooks via sendWebhook),
  // so a rejection here means the entry is already re-queued — logging only,
  // otherwise the same failure would land in the queue twice.
  deliverNotification(subscription as Subscription, payload).catch((error: any) => {
    console.error(
      `[delivery] replay of dead-letter ${entry.id} failed (already re-queued):`,
      error?.message ?? error
    );
  });
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    label: string;
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: string) => void;
    onDeadLetter?: (lastError: string) => void;
  }
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? CONFIG.webhookBackoffBaseMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        totalRetries++;
      }
      return result;
    } catch (error: any) {
      const errorMessage = error?.message ?? String(error);
      if (attempt < maxRetries) {
        activeRetries++;
        totalRetries++;
        options.onRetry?.(attempt, errorMessage);
        const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY);
        await delay(backoff);
      } else {
        options.onDeadLetter?.(errorMessage);
        throw error;
      }
    }
  }

  throw new Error(`Retry exhausted for ${options.label}`);
}

export async function sendEmail(
  subscription: Subscription,
  payload: NotificationPayload
): Promise<void> {
  await retryWithBackoff(
    async () => {
      await resend.emails.send({
        from: CONFIG.resendFromEmail,
        to: subscription.destination,
        subject: payload.subject,
        html: `<p>${payload.message}</p>
      <p><strong>Invoice #${payload.invoice.id}</strong></p>
      <p>Status: ${payload.invoice.status}</p>
      <p>Due date: ${new Date(payload.invoice.due_date * 1000).toISOString()}</p>`,
      });
    },
    {
      label: `email to ${subscription.destination}`,
      onDeadLetter: (lastError) => {
        pushDeadLetter({
          channel: 'email',
          destination: subscription.destination,
          subscriptionId: subscription.id,
          trigger: payload.trigger,
          invoice: payload.invoice,
          subject: payload.subject,
          message: payload.message,
          lastError,
          attempts: CONFIG.maxWebhookRetry,
        });
      },
    }
  );
}

function getWebhookSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export async function sendWebhook(
  subscription: Subscription,
  payload: NotificationPayload,
  attempt = 1,
  logId?: number
): Promise<void> {
  const body = JSON.stringify({
    trigger: payload.trigger,
    actor: payload.actor,
    invoice: payload.invoice,
    subject: payload.subject,
    message: payload.message,
    eventId: payload.eventId ?? null,
    eventType: payload.eventType ?? null,
  });

  const id =
    logId ??
    createWebhookDeliveryLog({
      subscription_id: subscription.id,
      event_id: payload.eventId ?? null,
      trigger: payload.trigger,
      invoice_id: payload.invoice.id,
      recipient_address: payload.recipientAddress,
      status: 'pending',
      attempts: 0,
      response_status: null,
      error: null,
    }).id;

  let response;
  let errorMessage: string | null = null;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-ILN-Trigger': payload.trigger,
      'X-ILN-Recipient': payload.recipientAddress,
    };

    if (subscription.webhook_secret) {
      headers['X-ILN-Signature'] = `sha256=${getWebhookSignature(
        subscription.webhook_secret,
        body
      )}`;
    }

    if (payload.eventId) {
      headers['X-ILN-Event-Id'] = payload.eventId;
    }

    response = await fetch(subscription.destination, {
      method: 'POST',
      headers,
      body,
    });

    await updateWebhookDeliveryLog(id, {
      attempts: attempt,
      response_status: response.status,
    });

    if (response.ok) {
      await updateWebhookDeliveryLog(id, {
        status: 'success',
      });
      return;
    }

    errorMessage = `HTTP ${response.status}`;
  } catch (error: any) {
    errorMessage = error?.message ?? 'Network Error';
    console.error(`[delivery] Webhook fetch error on attempt ${attempt}:`, error);
  }

  if (attempt >= CONFIG.maxWebhookRetry) {
    await updateWebhookDeliveryLog(id, {
      status: 'failed',
      attempts: attempt,
      error: errorMessage,
    });
    pushDeadLetter({
      channel: 'webhook',
      destination: subscription.destination,
      subscriptionId: subscription.id,
      trigger: payload.trigger,
      invoice: payload.invoice,
      subject: payload.subject,
      message: payload.message,
      lastError: errorMessage ?? 'Unknown error',
      attempts: attempt,
    });
    return;
  }

  totalRetries++;
  activeRetries++;

  await updateWebhookDeliveryLog(id, {
    attempts: attempt,
    response_status: response?.status ?? null,
    error: errorMessage,
  });

  const backoff = Math.min(CONFIG.webhookBackoffBaseMs * 2 ** (attempt - 1), MAX_RETRY_DELAY);
  await delay(backoff);
  await sendWebhook(subscription, payload, attempt + 1, id);
}

export async function sendSms(
  subscription: Subscription,
  payload: NotificationPayload
): Promise<void> {
  const client = getTwilioClient();
  if (!client) {
    throw new Error('Twilio credentials not configured');
  }

  const message = [
    payload.subject,
    '',
    `Invoice #${payload.invoice.id}`,
    `Status: ${payload.invoice.status}`,
    `Due date: ${new Date(payload.invoice.due_date * 1000).toISOString()}`,
  ].join('\n');

  await retryWithBackoff(
    async () => {
      await client.messages.create({
        to: subscription.destination,
        from: CONFIG.twilioFromNumber,
        body: message,
      });
    },
    {
      label: `sms to ${subscription.destination}`,
      onDeadLetter: (lastError) => {
        pushDeadLetter({
          channel: 'sms',
          destination: subscription.destination,
          subscriptionId: subscription.id,
          trigger: payload.trigger,
          invoice: payload.invoice,
          subject: payload.subject,
          message: payload.message,
          lastError,
          attempts: CONFIG.maxWebhookRetry,
        });
      },
    }
  );
}

export async function deliverNotification(
  subscription: Subscription,
  payload: NotificationPayload
): Promise<void> {
  if (subscription.channel === 'email') {
    await sendEmail(subscription, payload);
    return;
  }

  if (subscription.channel === 'sms') {
    await sendSms(subscription, payload);
    return;
  }

  await sendWebhook(subscription, payload);
}

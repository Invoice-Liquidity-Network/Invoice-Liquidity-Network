import { createHmac } from 'crypto';
import { Resend } from 'resend';
import Twilio from 'twilio';
import { CONFIG } from './config';
import {
  createWebhookDeliveryLog,
  updateWebhookDeliveryLog,
  createDeliveryAuditLog,
} from './db';
import { SSRFError, assertWebhookTargetPublic } from './ssrf';
import { escapeHtml, escapeHeaderValue, escapeSmsText } from './templates/helpers';
import { withSpan, propagateFetch } from '@iln/opentelemetry';
import type { NotificationPayload, Subscription, NotificationTrigger, Invoice } from './types';
import { notificationsMetrics } from './metrics';

function safeCreateAudit(entry: Parameters<typeof createDeliveryAuditLog>[0]): void {
  try {
    if (typeof createDeliveryAuditLog === 'function') {
      createDeliveryAuditLog(entry);
      try {
        notificationsMetrics.auditRecordsTotal.inc({ status: entry.status, channel: entry.channel });
      } catch {}
    }
  } catch {
    // Audit write is best-effort in mocked/test environments; never break delivery
  }
}

const COST_PER_DISPATCH_USD: Record<string, number> = {
  email: 0.0006,
  webhook: 0.0001,
  sms: 0.02,
  websocket: 0.00005,
};

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

// ── Circuit Breaker ──────────────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerEntry {
  failures: number;
  state: CircuitState;
  lastFailureAt: number;
  /** Timestamp (ms) when the circuit transitions from open to half-open. */
  nextProbeAt: number;
}

const circuitBreakers = new Map<string, CircuitBreakerEntry>();

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 60_000;

export function getCircuitBreakerState(destination: string): CircuitState {
  const entry = circuitBreakers.get(destination);
  if (!entry) return 'closed';
  return entry.state;
}

export function resetCircuitBreakers(): void {
  circuitBreakers.clear();
}

function recordCircuitSuccess(destination: string): void {
  circuitBreakers.delete(destination);
}

function recordCircuitFailure(destination: string): CircuitState {
  const now = Date.now();
  const existing = circuitBreakers.get(destination);

  if (!existing) {
    circuitBreakers.set(destination, {
      failures: 1,
      state: 'closed',
      lastFailureAt: now,
      nextProbeAt: 0,
    });
    return 'closed';
  }

  existing.failures++;
  existing.lastFailureAt = now;

  if (existing.failures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    existing.state = 'open';
    existing.nextProbeAt = now + CIRCUIT_BREAKER_RESET_TIMEOUT_MS;
  }

  return existing.state;
}

function shouldAllowRequest(destination: string): boolean {
  const entry = circuitBreakers.get(destination);
  if (!entry) return true;

  if (entry.state === 'closed') return true;

  if (entry.state === 'open' && Date.now() >= entry.nextProbeAt) {
    entry.state = 'half-open';
    return true;
  }

  if (entry.state === 'half-open') return true;

  return false;
}

// ── Dead Letter Queue ────────────────────────────────────────────────────────

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
  const destination = subscription.destination;
  const attemptTimestamps: number[] = [];
  const start = Date.now();
  if (!shouldAllowRequest(destination)) {
    console.warn(`[delivery] Circuit open for ${destination} — skipping email`);
    safeCreateAudit({
      invoice_id: payload.invoice.id,
      trigger: payload.trigger,
      recipient_address: payload.recipientAddress,
      channel: 'email',
      destination,
      event_id: payload.eventId ?? null,
      status: 'failed',
      attempts: 1,
      last_error: 'Circuit breaker open',
      attempt_timestamps: [Date.now()],
    });
    try {
      notificationsMetrics.failuresTotal.inc({ channel: 'email', reason: 'circuit_open' });
      notificationsMetrics.deliveryDuration.observe({ channel: 'email' }, (Date.now() - start) / 1000);
    } catch {}
    deadLetterQueue.push({
      channel: 'email',
      destination,
      subscriptionId: subscription.id,
      trigger: payload.trigger,
      invoice: payload.invoice,
      subject: payload.subject,
      message: payload.message,
      lastError: 'Circuit breaker open',
      attempts: 1,
      timestamp: Date.now(),
    });
    return;
  }

  let lastError: string | null = null;
  try {
    await retryWithBackoff(
      async () => {
        attemptTimestamps.push(Date.now());
        await resend.emails.send({
          from: CONFIG.resendFromEmail,
          to: subscription.destination,
          subject: safeSubject,
          html: `<p>${safeMessage}</p>
      <p><strong>Invoice #${safeId}</strong></p>
      <p>Status: ${safeStatus}</p>
      <p>Due date: ${safeDue}</p>`,
        });
      },
      {
        label: `email to ${subscription.destination}`,
        onRetry: (_attempt, error) => {
          lastError = error;
        },
        onDeadLetter: (deadLetterError) => {
          lastError = deadLetterError;
          deadLetterQueue.push({
            channel: 'email',
            destination: subscription.destination,
            subscriptionId: subscription.id,
            trigger: payload.trigger,
            invoice: payload.invoice,
            subject: payload.subject,
            message: payload.message,
            lastError: deadLetterError,
            attempts: CONFIG.maxWebhookRetry,
            timestamp: Date.now(),
          });
        },
      }
    );
    recordCircuitSuccess(destination);
    safeCreateAudit({
      invoice_id: payload.invoice.id,
      trigger: payload.trigger,
      recipient_address: payload.recipientAddress,
      channel: 'email',
      destination,
      event_id: payload.eventId ?? null,
      status: 'delivered',
      attempts: attemptTimestamps.length || 1,
      last_error: null,
      attempt_timestamps: attemptTimestamps.length ? attemptTimestamps : [Date.now()],
    });
    try {
      notificationsMetrics.dispatchesTotal.inc({ channel: 'email', trigger: payload.trigger });
      notificationsMetrics.costUsdTotal.inc({ channel: 'email', operation: 'dispatch' }, COST_PER_DISPATCH_USD.email);
      notificationsMetrics.deliveryDuration.observe({ channel: 'email' }, (Date.now() - start) / 1000);
    } catch {}
  } catch (error: any) {
    recordCircuitFailure(destination);
    const errMsg = error?.message ?? lastError ?? 'Unknown error';
    // Ensure we have at least one timestamp; retryWithBackoff already pushed for each attempt
    const timestamps =
      attemptTimestamps.length > 0 ? attemptTimestamps : [Date.now()];
    safeCreateAudit({
      invoice_id: payload.invoice.id,
      trigger: payload.trigger,
      recipient_address: payload.recipientAddress,
      channel: 'email',
      destination,
      event_id: payload.eventId ?? null,
      status: 'failed',
      attempts: timestamps.length,
      last_error: errMsg,
      attempt_timestamps: timestamps,
    });
    try {
      notificationsMetrics.failuresTotal.inc({ channel: 'email', reason: 'provider_error' });
      notificationsMetrics.deliveryDuration.observe({ channel: 'email' }, (Date.now() - start) / 1000);
    } catch {}
    throw new Error(`Circuit breaker: email delivery to ${destination} failed`);
  }
}

function getWebhookSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export async function sendWebhook(
  subscription: Subscription,
  payload: NotificationPayload,
  attempt = 1,
  logId?: number,
  auditTimestamps?: number[]
): Promise<void> {
  const destination = subscription.destination;
  const ts = auditTimestamps ?? [];
  // Record attempt timestamp at entry (for every attempt, including retries)
  ts.push(Date.now());

  if (!shouldAllowRequest(destination)) {
    console.warn(`[delivery] Circuit open for ${destination} — skipping webhook`);
    deadLetterQueue.push({
      channel: 'webhook',
      destination,
      subscriptionId: subscription.id,
      trigger: payload.trigger,
      invoice: payload.invoice,
      subject: payload.subject,
      message: payload.message,
      lastError: 'Circuit breaker open',
      attempts: attempt,
      timestamp: Date.now(),
    });
    safeCreateAudit({
      invoice_id: payload.invoice.id,
      trigger: payload.trigger,
      recipient_address: payload.recipientAddress,
      channel: 'webhook',
      destination,
      event_id: payload.eventId ?? null,
      status: 'failed',
      attempts: attempt,
      last_error: 'Circuit breaker open',
      attempt_timestamps: [...ts],
    });
    try {
      notificationsMetrics.failuresTotal.inc({ channel: 'webhook', reason: 'circuit_open' });
      notificationsMetrics.deliveryDuration.observe({ channel: 'webhook' }, (Date.now() - ts[0]) / 1000);
    } catch {}
    return;
  }

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
    await assertWebhookTargetPublic(subscription.destination);
  } catch (error: unknown) {
    const reason =
      error instanceof SSRFError ? error.message : 'Destination URL rejected as unsafe';
    console.error(`[delivery] Refusing unsafe webhook target for ${subscription.id}: ${reason}`);
    await updateWebhookDeliveryLog(id, { status: 'failed', attempts: attempt, error: reason });
    deadLetterQueue.push({
      channel: 'webhook',
      destination: subscription.destination,
      subscriptionId: subscription.id,
      trigger: payload.trigger,
      invoice: payload.invoice,
      subject: payload.subject,
      message: payload.message,
      lastError: reason,
      attempts: attempt,
      timestamp: Date.now(),
    });
    safeCreateAudit({
      invoice_id: payload.invoice.id,
      trigger: payload.trigger,
      recipient_address: payload.recipientAddress,
      channel: 'webhook',
      destination,
      event_id: payload.eventId ?? null,
      status: 'failed',
      attempts: attempt,
      last_error: reason,
      attempt_timestamps: [...ts],
    });
    try {
      notificationsMetrics.failuresTotal.inc({ channel: 'webhook', reason: 'ssrf_rejected' });
      notificationsMetrics.deliveryDuration.observe({ channel: 'webhook' }, (Date.now() - ts[0]) / 1000);
    } catch {}
    return;
  }

  try {
    // Header values escaped against CRLF injection; JSON body is via JSON.stringify (safe for JSON context)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-ILN-Trigger': escapeHeaderValue(payload.trigger),
      'X-ILN-Recipient': escapeHeaderValue(payload.recipientAddress),
    };

    if (subscription.webhook_secret) {
      headers['X-ILN-Signature'] = `sha256=${getWebhookSignature(
        subscription.webhook_secret,
        body
      )}`;
    }

    if (payload.eventId) {
      headers['X-ILN-Event-Id'] = escapeHeaderValue(payload.eventId);
    }

    response = await fetch(
      subscription.destination,
      propagateFetch({
        method: 'POST',
        headers,
        body,
      }),
    );

    await updateWebhookDeliveryLog(id, {
      attempts: attempt,
      response_status: response.status,
    });

    if (response.ok) {
      await updateWebhookDeliveryLog(id, {
        status: 'success',
      });
      recordCircuitSuccess(destination);
      safeCreateAudit({
        invoice_id: payload.invoice.id,
        trigger: payload.trigger,
        recipient_address: payload.recipientAddress,
        channel: 'webhook',
        destination,
        event_id: payload.eventId ?? null,
        status: 'delivered',
        attempts: attempt,
        last_error: null,
        attempt_timestamps: [...ts],
      });
      try {
        notificationsMetrics.dispatchesTotal.inc({ channel: 'webhook', trigger: payload.trigger });
        notificationsMetrics.costUsdTotal.inc({ channel: 'webhook', operation: 'dispatch' }, COST_PER_DISPATCH_USD.webhook);
        notificationsMetrics.deliveryDuration.observe({ channel: 'webhook' }, (Date.now() - ts[0]) / 1000);
      } catch {}
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
    recordCircuitFailure(destination);
    safeCreateAudit({
      invoice_id: payload.invoice.id,
      trigger: payload.trigger,
      recipient_address: payload.recipientAddress,
      channel: 'webhook',
      destination,
      event_id: payload.eventId ?? null,
      status: 'failed',
      attempts: attempt,
      last_error: errorMessage,
      attempt_timestamps: [...ts],
    });
    try {
      notificationsMetrics.failuresTotal.inc({ channel: 'webhook', reason: 'http_error' });
      notificationsMetrics.deliveryDuration.observe({ channel: 'webhook' }, (Date.now() - ts[0]) / 1000);
    } catch {}
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
  await sendWebhook(subscription, payload, attempt + 1, id, ts);
}

export async function sendSms(
  subscription: Subscription,
  payload: NotificationPayload
): Promise<void> {
  const client = getTwilioClient();
  if (!client) {
    throw new Error('Twilio credentials not configured');
  }

  const destination = subscription.destination;
  const attemptTimestamps: number[] = [];
  const startSms = Date.now();
  if (!shouldAllowRequest(destination)) {
    console.warn(`[delivery] Circuit open for ${destination} — skipping SMS`);
    safeCreateAudit({
      invoice_id: payload.invoice.id,
      trigger: payload.trigger,
      recipient_address: payload.recipientAddress,
      channel: 'sms',
      destination,
      event_id: payload.eventId ?? null,
      status: 'failed',
      attempts: 1,
      last_error: 'Circuit breaker open',
      attempt_timestamps: [Date.now()],
    });
    try {
      notificationsMetrics.failuresTotal.inc({ channel: 'sms', reason: 'circuit_open' });
      notificationsMetrics.deliveryDuration.observe({ channel: 'sms' }, (Date.now() - startSms) / 1000);
    } catch {}
    deadLetterQueue.push({
      channel: 'sms',
      destination,
      subscriptionId: subscription.id,
      trigger: payload.trigger,
      invoice: payload.invoice,
      subject: payload.subject,
      message: payload.message,
      lastError: 'Circuit breaker open',
      attempts: 1,
      timestamp: Date.now(),
    });
    return;
  }

  // SMS is plain-text — strip control chars / CRLF that could split messages or confuse carriers
  const message = escapeSmsText([
    payload.subject,
    '',
    `Invoice #${payload.invoice.id}`,
    `Status: ${payload.invoice.status}`,
    `Due date: ${new Date(payload.invoice.due_date * 1000).toISOString()}`,
  ].join('\n'));

  let lastError: string | null = null;
  try {
    await retryWithBackoff(
      async () => {
        attemptTimestamps.push(Date.now());
        await client.messages.create({
          to: subscription.destination,
          from: CONFIG.twilioFromNumber,
          body: message,
        });
      },
      {
        label: `sms to ${subscription.destination}`,
        onRetry: (_attempt, error) => {
          lastError = error;
        },
        onDeadLetter: (deadLetterError) => {
          lastError = deadLetterError;
          deadLetterQueue.push({
            channel: 'sms',
            destination: subscription.destination,
            subscriptionId: subscription.id,
            trigger: payload.trigger,
            invoice: payload.invoice,
            subject: payload.subject,
            message: payload.message,
            lastError: deadLetterError,
            attempts: CONFIG.maxWebhookRetry,
            timestamp: Date.now(),
          });
        },
      }
    );
    recordCircuitSuccess(destination);
    safeCreateAudit({
      invoice_id: payload.invoice.id,
      trigger: payload.trigger,
      recipient_address: payload.recipientAddress,
      channel: 'sms',
      destination,
      event_id: payload.eventId ?? null,
      status: 'delivered',
      attempts: attemptTimestamps.length || 1,
      last_error: null,
      attempt_timestamps: attemptTimestamps.length ? attemptTimestamps : [Date.now()],
    });
    try {
      notificationsMetrics.dispatchesTotal.inc({ channel: 'sms', trigger: payload.trigger });
      notificationsMetrics.costUsdTotal.inc({ channel: 'sms', operation: 'dispatch' }, COST_PER_DISPATCH_USD.sms);
      notificationsMetrics.deliveryDuration.observe({ channel: 'sms' }, (Date.now() - startSms) / 1000);
    } catch {}
  } catch (error: any) {
    recordCircuitFailure(destination);
    const errMsg = error?.message ?? lastError ?? 'Unknown error';
    const timestamps = attemptTimestamps.length ? attemptTimestamps : [Date.now()];
    safeCreateAudit({
      invoice_id: payload.invoice.id,
      trigger: payload.trigger,
      recipient_address: payload.recipientAddress,
      channel: 'sms',
      destination,
      event_id: payload.eventId ?? null,
      status: 'failed',
      attempts: timestamps.length,
      last_error: errMsg,
      attempt_timestamps: timestamps,
    });
    try {
      notificationsMetrics.failuresTotal.inc({ channel: 'sms', reason: 'provider_error' });
      notificationsMetrics.deliveryDuration.observe({ channel: 'sms' }, (Date.now() - startSms) / 1000);
    } catch {}
    throw new Error(`Circuit breaker: SMS delivery to ${destination} failed`);
  }
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

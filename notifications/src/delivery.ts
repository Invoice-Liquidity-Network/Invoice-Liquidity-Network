import { Resend } from 'resend';
import { CONFIG } from './config';
import type { NotificationPayload, Subscription } from './types';

const resend = new Resend(CONFIG.resendApiKey);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendEmail(
  subscription: Subscription,
  payload: NotificationPayload
): Promise<void> {
  await resend.emails.send({
    from: CONFIG.resendFromEmail,
    to: subscription.destination,
    subject: payload.subject,
    html: `<p>${payload.message}</p>
      <p><strong>Invoice #${payload.invoice.id}</strong></p>
      <p>Status: ${payload.invoice.status}</p>
      <p>Due date: ${new Date(payload.invoice.due_date * 1000).toISOString()}</p>`,
  });
}

export async function sendWebhook(
  subscription: Subscription,
  payload: NotificationPayload,
  attempt = 1
): Promise<void> {
  let response;
  try {
    response = await fetch(subscription.destination, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trigger: payload.trigger,
        actor: payload.actor,
        invoice: payload.invoice,
        subject: payload.subject,
        message: payload.message,
      }),
    });

    if (response.ok) {
      return;
    }
  } catch (error) {
    // Network errors will be caught here and retried
    console.error(`[delivery] Webhook fetch error on attempt ${attempt}:`, error);
  }

  if (attempt >= CONFIG.maxWebhookRetry) {
    throw new Error(
      `Webhook failed after ${attempt} attempts: ${response?.status || 'Network Error'}`
    );
  }

  const backoff = CONFIG.webhookBackoffBaseMs * 2 ** (attempt - 1);
  await delay(backoff);
  await sendWebhook(subscription, payload, attempt + 1);
}

export async function deliverNotification(
  subscription: Subscription,
  payload: NotificationPayload
): Promise<void> {
  if (subscription.channel === 'email') {
    await sendEmail(subscription, payload);
    return;
  }

  await sendWebhook(subscription, payload);
}

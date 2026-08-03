/**
 * Enumeration of notification trigger events.
 * Each trigger corresponds to an invoice lifecycle event.
 */
export enum NotificationTrigger {
  InvoiceSubmitted = "invoice_submitted",
  InvoiceFunded = "invoice_funded",
  InvoiceSettled = "invoice_paid",
  InvoiceDisputed = "invoice_disputed",
  InvoiceDefaulted = "invoice_defaulted",
  DueDateWarning = "invoice_due_soon",
}

/** Supported notification delivery channels. */
export type SubscriptionChannel = "email" | "webhook";

/**
 * A notification subscription record.
 *
 * @property id - Unique subscription ID.
 * @property stellar_address - The Stellar address this subscription is for.
 * @property channel - The delivery channel (email or webhook).
 * @property destination - The email address or webhook URL.
 * @property triggers - The events that trigger notifications.
 * @property created_at - Unix timestamp when the subscription was created.
 */
export interface Subscription {
  id: number;
  stellar_address: string;
  channel: SubscriptionChannel;
  destination: string;
  triggers: NotificationTrigger[];
  created_at: number;
}

/**
 * Client for managing ILN notification subscriptions.
 * Supports email and webhook delivery channels for invoice lifecycle events.
 *
 * @example
 * ```ts
 * const client = new NotificationsClient("https://api.iln.network");
 *
 * // Subscribe to email notifications
 * const sub = await client.subscribeEmail(
 *   "GABC...",
 *   "user@example.com",
 *   [NotificationTrigger.InvoiceFunded, NotificationTrigger.InvoiceSettled],
 * );
 *
 * // Subscribe to webhook notifications
 * await client.subscribeWebhook(
 *   "GABC...",
 *   "https://myapp.com/webhook/iln",
 *   [NotificationTrigger.InvoiceDefaulted],
 * );
 * ```
 */
export class NotificationsClient {
  private readonly baseUrl: string;

  /**
   * Create a new notifications client.
   * @param baseUrl - The base URL of the ILN notifications API.
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Subscribe to email notifications for a Stellar address.
   *
   * @param address - The Stellar address to monitor.
   * @param email - The email address to send notifications to.
   * @param triggers - The events that should trigger email notifications.
   * @returns The created subscription record.
   *
   * @example
   * ```ts
   * const sub = await client.subscribeEmail(
   *   "GABC...",
   *   "user@example.com",
   *   [NotificationTrigger.InvoiceFunded],
   * );
   * ```
   */
  async subscribeEmail(
    address: string,
    email: string,
    triggers: NotificationTrigger[]
  ): Promise<Subscription> {
    const response = await fetch(`${this.baseUrl}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stellar_address: address,
        channel: "email",
        destination: email,
        triggers,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to subscribe email: ${await response.text()}`);
    }

    const data = await response.json();
    return data.subscription;
  }

  /**
   * Subscribe to webhook notifications for a Stellar address.
   *
   * @param address - The Stellar address to monitor.
   * @param url - The webhook URL to receive POST requests.
   * @param triggers - The events that should trigger webhook calls.
   * @returns The created subscription record.
   *
   * @example
   * ```ts
   * const sub = await client.subscribeWebhook(
   *   "GABC...",
   *   "https://myapp.com/webhook/iln",
   *   [NotificationTrigger.InvoiceDefaulted],
   * );
   * ```
   */
  async subscribeWebhook(
    address: string,
    url: string,
    triggers: NotificationTrigger[]
  ): Promise<Subscription> {
    const response = await fetch(`${this.baseUrl}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stellar_address: address,
        channel: "webhook",
        destination: url,
        triggers,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to subscribe webhook: ${await response.text()}`);
    }

    const data = await response.json();
    return data.subscription;
  }

  /**
   * Unsubscribe from a notification subscription.
   *
   * @param subscriptionId - The ID of the subscription to remove.
   *
   * @example
   * ```ts
   * await client.unsubscribe(subscription.id);
   * ```
   */
  async unsubscribe(subscriptionId: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/unsubscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: subscriptionId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to unsubscribe: ${await response.text()}`);
    }
  }

  /**
   * List all active notification subscriptions for a Stellar address.
   *
   * @param address - The Stellar address to query.
   * @returns Array of active subscriptions.
   *
   * @example
   * ```ts
   * const subs = await client.listSubscriptions("GABC...");
   * console.log(`${subs.length} active subscriptions`);
   * ```
   */
  async listSubscriptions(address: string): Promise<Subscription[]> {
    const response = await fetch(`${this.baseUrl}/subscriptions/${encodeURIComponent(address)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to list subscriptions: ${await response.text()}`);
    }

    const data = await response.json();
    return data.subscriptions;
  }

  /**
   * Test a webhook subscription by sending a test payload.
   *
   * @param subscriptionId - The ID of the webhook subscription to test.
   * @returns Test result including success status and HTTP status code.
   *
   * @example
   * ```ts
   * const result = await client.testWebhook(subscription.id);
   * console.log(`Webhook test: ${result.success ? "OK" : "Failed"}`);
   * ```
   */
  async testWebhook(subscriptionId: number): Promise<{ success: boolean; statusCode: number }> {
    const response = await fetch(`${this.baseUrl}/test-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: subscriptionId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to test webhook: ${await response.text()}`);
    }

    return await response.json();
  }
}

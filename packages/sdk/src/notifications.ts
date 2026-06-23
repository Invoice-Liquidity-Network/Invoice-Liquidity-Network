export enum NotificationTrigger {
  InvoiceFunded = "invoice_funded",
  InvoiceSettled = "invoice_paid",
  InvoiceDefaulted = "invoice_defaulted",
  DueDateWarning = "invoice_due_soon",
}

export type SubscriptionChannel = "email" | "webhook";

export interface Subscription {
  id: number;
  stellar_address: string;
  channel: SubscriptionChannel;
  destination: string;
  triggers: NotificationTrigger[];
  created_at: number;
}

export class NotificationsClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

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
